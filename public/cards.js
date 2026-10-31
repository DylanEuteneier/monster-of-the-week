// @ts-check
/**
 * A player card as the table draws it: shared by the table (app.js) and the
 * assets page's card review. Display only; holds no rules.
 */
import { spec, factionById, cardById } from './rules.js';
import art from './assets/sprites.json' with { type: 'json' };
import { NOUNS, iconHtml, suitedMark } from './icons.js';

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
  // A signature's sway is X, the cards in your hand (designer, 2026-10-30): the button shows X, the tip the count now.
  const now = view?.printed?.[id];
  const printed = c.slot === 'signature' ? 'X' : (now ?? c.sway);
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
    // Not live (out of turn, or the assets page): shown at full strength, not as disabled; a dimmed card dims it.
    : `<span class="card-opt" title="${esc(tip)}">${inner}</span>`;
  const options = c.suit ? `<div class="card-options">
      ${c.action ? opt('set-mode', 'LOC', `Location target: ${r?.location ?? ''}${o.empty?.includes('location') ? ' Nothing to target right now.' : ''}`, o.reading === 'location', { mode: 'location' }) : ''}
      ${c.action ? opt('set-mode', 'FAC', `Faction target: ${r?.faction ?? ''}${sf ? ` (${fname(sf)})` : ''}${o.empty?.includes('faction') ? ' Nothing to target right now.' : ''}`, o.reading === 'faction', { mode: 'faction' }) : ''}
      ${opt('sway', `<b>+${printed}</b>`, `Spend for ${printed} sway with ${sf ? fname(sf) : `the ${suit?.name ?? ''} faction`}`, false)}
      ${o.back ? opt('return', 'BACK', `Bring ${sf ? fname(sf) : 'its faction'} back: up to its sway of tokens at its own locations or where it is, 1 standing with it each`, false) : ''}
    </div>` : '';
  const classes = ['card', `card-suit-${c.suit ?? 'none'}`, o.ticked ? 'card-ticked' : '', o.mode ? `card-${o.mode}` : '', o.dim ? 'card-dim' : '', o.selected ? 'card-selected' : '', o.selected && o.next ? 'card-needs-reading' : ''].filter(Boolean).join(' ');
  const full = `${c.name}. ${c.text}`;
  if ('layout' in c && c.layout) return laidOut(c, o, { id, classes, full, band, printed, now, sf, live, opt, why, r, suitName: suit?.name ?? '' });
  // No title tooltip: the card itself shows the text, and a tooltip only covered it (designer, 2026-10-29).
  return `<div class="${classes}" data-card="${esc(id)}" aria-label="${esc(full)}"${o.mode ? ` data-card-mode="${o.mode}"` : ''}>
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

/**
 * A card in the layout the designer chose (2026-10-30): the topline (its action's icon block, verb and gist), its
 * target with each reading as a button-like row led by its mark, one specific rule per line, and its thematic text
 * at the bottom. Suited marks: the suit's colour for its locations and faction, none where the suit doesn't matter.
 * @param {any} c @param {CardOptions} o @param {any} k
 */
function laidOut(c, o, k) {
  const l = c.layout;
  const suit = c.suit ?? '';
  const top = `<div class="lay-top">${iconHtml(l.verb, l.noun)}<div><b class="lay-verb">${esc(l.word)}</b><span class="lay-gist">${esc(l.gist)}</span></div></div>`;
  const text = (/** @type {string[] | string} */ x) => Array.isArray(x)
    ? `<span class="lay-parts">${x.map((p, i) => `<span><i>${esc(l.parts[i])}</i> ${esc(p)}</span>`).join('')}</span>`
    : `<span>${esc(x)}</span>`;
  /** A reading's row: a button while the card is live, its mark in the tag cell. */
  const reading = (/** @type {'location' | 'faction'} */ m) => {
    const mark = m === 'location' ? suitedMark('location', suit) : suitedMark(l.facMark ?? 'group', suit);
    const words = m === 'location' ? (l.loc ?? k.r.location) : (l.fac ?? `${k.r.faction}${k.sf ? ` (${fname(k.sf)})` : ''}`);
    const state = o.reading ? (o.reading === m ? ' is-on' : ' is-off') : '';
    const label = m === 'location' ? 'Location reading' : 'Faction reading';
    const inner = `<b title="${label}">${mark}</b>${text(words)}`;
    const empty = o.empty?.includes(m) ? ' is-empty' : '';
    return k.live
      ? `<button class="lay-row lay-row-ic${state}${o.next ? ' is-next' : ''}${empty}" data-action="set-mode" data-card="${esc(k.id)}" data-mode="${m}" aria-label="${label}">${inner}</button>${k.why(m)}`
      : `<div class="lay-row lay-row-ic${state}" aria-label="${label}">${inner}</div>`;
  };
  const markOf = (/** @type {string} */ m) => NOUNS[m]?.svg ?? '';
  const target = c.suit
    ? `<div class="lay-target"><div class="lay-label">Target: ${esc(l.target)}</div>${reading('location')}${reading('faction')}</div>`
    : l.uses
      ? `<div class="lay-target"><div class="lay-label">${l.uses.length > 1 ? 'Choose one' : 'Target'}</div>${l.uses.map((/** @type {any} */ u) => `<div class="lay-row lay-row-ic${o.use ? (o.use === u.id ? ' is-on' : ' is-off') : ''}" aria-label="${esc(u.id)}"><b title="${esc(u.id)}">${markOf(u.mark)}</b><span>${esc(u.text.charAt(0).toUpperCase() + u.text.slice(1))}</span></div>`).join('')}</div>`
      : `<div class="lay-target"><div class="lay-label">Target: ${esc(l.target)}</div><div class="lay-row lay-row-ic"><b>${markOf(l.single ?? 'group')}</b><span>${esc(l.target.charAt(0).toUpperCase() + l.target.slice(1))}</span></div></div>`;
  const specifics = l.specifics.length ? `<ul class="lay-specifics">${l.specifics.map((/** @type {string} */ s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
  const flavour = `<p class="lay-flavour">${esc(l.flavour)}</p>`;
  // Spent for sway: standing with the suit's faction, its cube in the suit's colour, and the amount.
  const sway = c.suit ? k.opt('sway', `${suitedMark('standing', suit)}<b>${k.printed}</b>`, `Spend for ${k.printed} sway with ${k.sf ? fname(k.sf) : `the ${k.suitName} faction`}${c.slot === 'signature' ? `: 1 per card in your hand, this one included${k.now !== undefined ? ` (${k.now} now)` : ''}` : ''}`, false) : '';
  const back = o.back ? k.opt('return', 'BACK', `Bring ${k.sf ? fname(k.sf) : 'its faction'} back: up to its sway of tokens at its own locations or where it is, 1 standing with it each`, false) : '';
  return `<div class="${k.classes} lay-card" data-card="${esc(k.id)}" aria-label="${esc(k.full)}"${o.mode ? ` data-card-mode="${o.mode}"` : ''}>
    <div class="card-band">${k.band}</div>
    <div class="lay-name"><span class="card-name">${esc(c.name)}</span><span class="lay-plays">${sway}${back}</span></div>
    ${top}${target}${specifics}${flavour}
    ${o.extra ?? ''}
  </div>`;
}

