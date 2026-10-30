// @ts-check
/**
 * Host page: unlock with the admin secret, see the table, deal a new game,
 * copy seat links. Every action is a call to /admin/*; nothing here touches
 * game rules. The option pickers are built from the variants in spec.json.
 */
import { spec, variants, tableLeans } from './rules.js';

const KEY_STORAGE = 'motw-host-key';
const MIN_SEATS = spec.meta.players.min;
const MAX_SEATS = spec.meta.players.max;
const DEFAULT_SEATS = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'];
const TOAST_MS = 3000;
/** What can sit in a seat: a human or a bot (one bot, its lean set by the table's leans; designer, 2026-10-29). */
const SEAT_KINDS = [['', 'Human'], ['bot', 'Bot']];
/** The lean slider's range and step (the bot's own range, D31). */
const LEAN = { min: -0.3, max: 0.3, step: 0.05 };
/** The advanced settings, in small groups (presentation only; every variant in spec.json lands in one). @type {[string, string[]][]} */
const GROUPS = [
  ['The island and its monsters', ['seeding', 'factionTokens', 'growth', 'alignedGrowth', 'swayTokens', 'wayBack']],
  ['Sway and standing', ['startSway', 'startOthers', 'startBoard', 'playerCubes', 'swayPerMove', 'cardSway']],
  ['Rounds and winning', ['rounds', 'threshold', 'passing', 'groups']],
];
/** A bot's profile in words: its lean, toward backing a faction (+) or the island (−). @param {string} profile */
function profileLabel(profile) {
  const lean = Number(/lean=(-?[0-9.]+)/.exec(profile)?.[1] ?? 0);
  return `lean ${lean > 0 ? '+' : ''}${lean} (${lean > 0 ? 'backs a faction' : lean < 0 ? 'plays for the island' : 'neutral'})`;
}

/** @typedef {{ player: string, url: string }} Link */
/** @typedef {{ hasGame: boolean, options?: Record<string, string>, phase?: string, round?: number, bots?: string[], botProfiles?: Record<string, string>, players?: { id: string, online: boolean, bot?: boolean, profile?: string }[] }} Status */

const host = {
  key: sessionStorage.getItem(KEY_STORAGE) ?? '',
  /** true once the server has accepted a request (with or without a key) */
  unlocked: false,
  /** @type {Status | null} */
  status: null,
  /** @type {Link[]} */
  links: [],
  /** @type {string[]} */
  seats: DEFAULT_SEATS.slice(),
  /** Each seat: '' for a human, else 'bot'. @type {string[]} */
  botSeats: DEFAULT_SEATS.map(() => ''),
  /** Each seat's lean if it is a bot; null until set (then the balanced spread fills it). @type {(number | null)[]} */
  leans: DEFAULT_SEATS.map(() => /** @type {number | null} */ (null)),
};

/** Fill unset bot leans from the balanced spread, and optionally reset them all (balance) or shuffle them. @param {'fill' | 'balance' | 'shuffle'} how */
function settleLeans(how) {
  const bots = host.botSeats.map((kind, idx) => (kind ? idx : -1)).filter((idx) => idx >= 0);
  if (how === 'fill' && bots.every((idx) => host.leans[idx] !== null)) return;
  const spread = /** @type {number[]} */ (tableLeans(bots.length));
  if (how === 'shuffle') for (let i = spread.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [spread[i], spread[j]] = [spread[j], spread[i]]; }
  bots.forEach((idx, k) => { if (how !== 'fill' || host.leans[idx] === null) host.leans[idx] = spread[k]; });
}

/** A lean in words, for the slider's row. @param {number} lean */
const leanWords = (lean) => `${lean > 0 ? '+' : ''}${lean.toFixed(2)} · ${lean > 0 ? 'backs a faction' : lean < 0 ? 'plays for the island' : 'neutral'}`;

/** @param {Record<string, string> | undefined} options */
function optionsLabel(options = {}) {
  const parts = variants.map((variant) => {
    const choice = variant.choices.find((candidate) => candidate.id === options[variant.id]);
    return `${variant.label}: ${choice?.label ?? options[variant.id] ?? '?'}`;
  });
  return parts.join(' · ') || 'no variants';
}

/** @param {unknown} value */
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

/** @param {string} id */
function $(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
}

/** @param {string} text @param {'error' | 'info'} [kind] */
function toast(text, kind = 'error') {
  const element = $('toast');
  element.textContent = text;
  element.className = `toast ${kind === 'info' ? 'info' : ''}`;
  element.hidden = false;
  setTimeout(() => {
    element.hidden = true;
  }, TOAST_MS);
}

/** @param {{ path: string, method?: string, body?: unknown }} request */
async function call(request) {
  const response = await fetch(request.path, {
    method: request.method ?? 'GET',
    headers: { ...(host.key ? { authorization: `Bearer ${host.key}` } : {}), 'content-type': 'application/json' },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(parsed.error ?? `${response.status}`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderUnlocked() {
  const unlocked = host.unlocked;
  $('status-panel').hidden = !unlocked;
  $('deal-panel').hidden = !unlocked;
  $('links-panel').hidden = !unlocked || host.links.length === 0;
  $('key-panel').hidden = unlocked;
}

function renderStatus() {
  const status = host.status;
  if (!status) return;
  if (!status.hasGame) {
    $('status').innerHTML = '<p class="muted">No game has been dealt yet.</p>';
    return;
  }
  const players = (status.players ?? []).map((player) => `
    <div class="player">
      <span class="swatch" style="background:var(--color-border)"></span>
      <span class="player-name"><span class="presence ${player.online ? 'presence-on' : ''}"></span>${esc(player.id)}</span>
      <span class="player-status">${player.bot ? `bot · ${esc(profileLabel(player.profile ?? ''))}` : player.online ? 'connected' : 'away'}</span>
    </div>`);
  $('status').innerHTML = `<p>Round <b>${status.round}</b> — <b>${esc(status.phase)}</b> · ${esc(optionsLabel(status.options))}</p><div class="player-list">${players.join('')}</div>`;
}

function renderSeats() {
  settleLeans('fill');
  $('seats').innerHTML = host.seats.map((name, idx) => {
    const lean = host.leans[idx] ?? 0;
    // A bot's lean on its own row beneath it (designer, 2026-10-29).
    const leanRow = host.botSeats[idx] ? `
      <label class="seat-lean small muted">Lean
        <span>Island</span>
        <input type="range" data-lean="${idx}" min="${LEAN.min}" max="${LEAN.max}" step="${LEAN.step}" value="${lean}" aria-label="${esc(name || `Seat ${idx + 1}`)}'s lean">
        <span>Backing</span>
        <span class="seat-lean-value" data-lean-value="${idx}">${esc(leanWords(lean))}</span>
      </label>` : '';
    return `
    <div class="seat">
      <div class="inline">
        <input type="text" class="grow" data-seat="${idx}" value="${esc(name)}" maxlength="20" placeholder="Seat ${idx + 1}" aria-label="Seat ${idx + 1} name">
        <select data-bot="${idx}" aria-label="Seat ${idx + 1} player">${SEAT_KINDS.map(([id, label]) => `<option value="${id}" ${host.botSeats[idx] === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
        <button class="btn" type="button" data-action="remove-seat" data-seat="${idx}" ${host.seats.length <= MIN_SEATS ? 'disabled' : ''}>Remove</button>
      </div>${leanRow}
    </div>`;
  }).join('');
  $('deal-note').textContent = host.status?.hasGame && host.status.phase !== 'ended' ? 'A game is in progress; dealing replaces it.' : '';
  renderSummary();
}

/** The line under the Deal button: who sits where, and which settings differ from the defaults. */
function renderSummary() {
  const seats = host.seats.map((name, idx) => (host.botSeats[idx] ? `${name || '?'} (bot ${(host.leans[idx] ?? 0) > 0 ? '+' : ''}${(host.leans[idx] ?? 0).toFixed(2)})` : name || '?'));
  const opts = readOptions();
  const changed = variants.filter((v) => opts[v.id] !== v.default).map((v) => `${v.label}: ${v.choices.find((c) => c.id === opts[v.id])?.label ?? opts[v.id]}`);
  $('deal-summary').textContent = `${seats.join(', ')} · ${changed.length ? `changed: ${changed.join(' · ')}` : 'the default rules'}`;
  $('seats-count').textContent = `(${host.seats.length} seats, ${host.botSeats.filter(Boolean).length} bots)`;
  for (const [title, ids] of GROUPS) {
    const n = ids.filter((id) => variants.some((v) => v.id === id && opts[id] !== v.default)).length;
    const el = document.querySelector(`[data-group-count="${CSS.escape(title)}"]`);
    if (el) el.textContent = n ? `(${n} changed)` : '';
  }
}

/** The variants, in small expandable groups: each a dropdown, its chosen setting described beneath. */
function renderOptions() {
  const placed = new Set(GROUPS.flatMap(([, ids]) => ids));
  /** @type {[string, string[]][]} */
  const groups = [...GROUPS, ['Other', variants.map((v) => v.id).filter((id) => !placed.has(id))]];
  const shown = groups.filter(([, ids]) => ids.length);
  const field = (/** @type {import('./rules.js').Variant} */ variant) => `
    <label class="option-row">
      <span class="option-label">${esc(variant.label)}</span>
      <select name="option-${esc(variant.id)}" title="${esc(variant.description)}">${variant.choices.map((choice) => `<option value="${esc(choice.id)}" ${choice.id === variant.default ? 'selected' : ''}>${esc(choice.label)}${choice.id === variant.default ? ' (default)' : ''}</option>`).join('')}</select>
      <span class="small muted option-note" data-note="${esc(variant.id)}">${esc(variant.choices.find((c) => c.id === variant.default)?.description ?? '')}</span>
    </label>`;
  $('options').innerHTML = shown.map(([title, ids]) => `
    <details class="setting-group">
      <summary>${esc(title)} <span class="small muted" data-group-count="${esc(title)}"></span></summary>
      ${variants.filter((v) => ids.includes(v.id)).map(field).join('')}
    </details>`).join('');
}

function renderLinks() {
  $('links').innerHTML = host.links.map((link) => `
    <div class="link-row">
      <b>${esc(link.player)}</b>
      <a class="mono small" href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.url)}</a>
      <button class="btn" data-action="copy" data-url="${esc(link.url)}">Copy</button>
    </div>`).join('');
  $('links-panel').hidden = host.links.length === 0;
}

function render() {
  renderUnlocked();
  renderStatus();
  renderSeats();
  renderLinks();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function refresh() {
  try {
    host.status = await call({ path: '/admin/status' });
    host.unlocked = true;
    if (host.status?.hasGame) {
      host.links = (await call({ path: '/admin/links' })).links;
      host.seats = host.links.map((link) => link.player);
      host.botSeats = host.seats.map((seat) => (host.status?.bots?.includes(seat) ? 'bot' : ''));
      // The table's own leans, so the next deal starts from them.
      host.leans = host.seats.map((seat) => { const m = /lean=(-?[0-9.]+)/.exec(host.status?.botProfiles?.[seat] ?? ''); return m ? Number(m[1]) : null; });
    }
    render();
  } catch (error) {
    if (error instanceof Error && error.message === 'unauthorised') {
      const hadKey = host.key !== '';
      host.key = '';
      host.unlocked = false;
      sessionStorage.removeItem(KEY_STORAGE);
      render();
      return hadKey ? toast('That key was not accepted') : undefined;
    }
    toast(error instanceof Error ? error.message : String(error));
  }
}

/** @param {SubmitEvent} event */
async function onUnlock(event) {
  event.preventDefault();
  const input = /** @type {HTMLInputElement} */ ($('key-input'));
  host.key = input.value.trim();
  if (!host.key) return;
  sessionStorage.setItem(KEY_STORAGE, host.key);
  await refresh();
}

function readSeatNames() {
  const inputs = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('input[data-seat]')]);
  return inputs.map((input) => input.value.trim());
}

function readBotSeats() {
  const inputs = /** @type {HTMLSelectElement[]} */ ([...document.querySelectorAll('select[data-bot]')]);
  return inputs.map((input) => input.value);
}

function readOptions() {
  return Object.fromEntries(variants.map((variant) => {
    const select = /** @type {HTMLSelectElement | null} */ (document.querySelector(`select[name="option-${variant.id}"]`));
    return [variant.id, select?.value ?? variant.default];
  }));
}

/** @param {SubmitEvent} event */
async function onDeal(event) {
  event.preventDefault();
  const players = readSeatNames();
  if (players.some((name) => !name)) return toast('Every seat needs a name');
  if (new Set(players).size !== players.length) return toast('Seat names must be unique');
  if (players.length < MIN_SEATS || players.length > MAX_SEATS) return toast(`A game seats ${MIN_SEATS}–${MAX_SEATS}`);
  const seedRaw = /** @type {HTMLInputElement} */ ($('seed-input')).value.trim();
  const kinds = readBotSeats();
  const bots = players.filter((_, idx) => kinds[idx]);
  if (bots.length >= players.length) return toast('At least one seat must be human');
  const botProfiles = Object.fromEntries(players.map((name, idx) => [name, idx]).filter(([, idx]) => kinds[Number(idx)]).map(([name, idx]) => [name, `bot:lean=${host.leans[Number(idx)] ?? 0}`]));
  const body = { players, bots, botProfiles, force: true, options: readOptions(), ...(seedRaw ? { seed: Number(seedRaw) } : {}) };
  const button = /** @type {HTMLButtonElement} */ ($('deal-button'));
  button.disabled = true;
  try {
    const result = await call({ path: '/admin/new-game', method: 'POST', body });
    host.links = result.links;
    toast(`Dealt seed ${result.seed} · ${optionsLabel(result.options)}`, 'info');
    await refresh();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  } finally {
    button.disabled = false;
  }
}

/** @param {string} text */
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied', 'info');
  } catch {
    toast('Clipboard blocked — select the link and copy it by hand');
  }
}

/** @param {MouseEvent} event */
function onClick(event) {
  const target = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  if (action === 'refresh') return void refresh();
  if (action === 'copy') return void copy(target.dataset.url ?? '');
  if (action === 'copy-all') return void copy(host.links.map((link) => `${link.player}: ${link.url}`).join('\n'));
  if (action === 'add-seat' && host.seats.length < MAX_SEATS) {
    host.seats = [...readSeatNames(), ''];
    host.botSeats = [...readBotSeats(), ''];
    host.leans = [...host.leans, null];
    return renderSeats();
  }
  if (action === 'remove-seat') {
    const removed = Number(target.dataset.seat);
    host.seats = readSeatNames().filter((_, idx) => idx !== removed);
    host.botSeats = readBotSeats().filter((_, idx) => idx !== removed);
    host.leans = host.leans.filter((_, idx) => idx !== removed);
    return renderSeats();
  }
  if (action === 'spread-leans' || action === 'shuffle-leans') {
    host.seats = readSeatNames();
    settleLeans(action === 'spread-leans' ? 'balance' : 'shuffle');
    return renderSeats();
  }
}

function main() {
  document.addEventListener('click', onClick);
  $('key-form').addEventListener('submit', onUnlock);
  $('deal-form').addEventListener('submit', onDeal);
  // Settings and seats change as you go: a bot seat gets a lean row; a setting shows its choice's description.
  $('deal-form').addEventListener('change', (event) => {
    const el = event.target;
    if (el instanceof HTMLSelectElement && el.dataset.bot !== undefined) {
      host.seats = readSeatNames();
      host.botSeats = readBotSeats();
      return renderSeats();
    }
    if (el instanceof HTMLSelectElement && el.name.startsWith('option-')) {
      const v = variants.find((x) => `option-${x.id}` === el.name);
      const note = document.querySelector(`[data-note="${CSS.escape(v?.id ?? '')}"]`);
      if (note) note.textContent = v?.choices.find((c) => c.id === el.value)?.description ?? '';
    }
    if (el instanceof HTMLInputElement && el.dataset.seat !== undefined) host.seats = readSeatNames();
    renderSummary();
  });
  $('deal-form').addEventListener('input', (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement) || el.dataset.lean === undefined) return;
    const idx = Number(el.dataset.lean);
    host.leans[idx] = Number(el.value);
    const words = document.querySelector(`[data-lean-value="${idx}"]`);
    if (words) words.textContent = leanWords(Number(el.value));
    renderSummary();
  });
  renderOptions();
  render();
  void refresh(); // open servers answer without a key; locked ones show the key panel
}

main();
