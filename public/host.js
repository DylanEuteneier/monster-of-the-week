// @ts-check
/**
 * Host page: unlock with the admin secret, see the table, deal a new game,
 * copy seat links. Every action is a call to /admin/*; nothing here touches
 * game rules. The option pickers are built from the variants in spec.json.
 */
import { spec, variants } from './engine.js';
import { PROFILES } from './bots.js';

const KEY_STORAGE = 'motw-host-key';
const MIN_SEATS = spec.meta.players.min;
const MAX_SEATS = spec.meta.players.max;
const DEFAULT_SEATS = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'];
const TOAST_MS = 3000;
/** The bot profiles (public/bots.js), as the host sees them. */
const PROFILE_LABELS = /** @type {Record<string, string>} */ ({
  goal: 'goal (adapts; leans to trophies)',
  'goal-deep': 'goal, deep (looks a reply ahead)',
  backer: 'backer (adapts; leans to backing a faction)',
});
/** What can sit in a seat: a human, a bot with a random profile, or a bot with a chosen one. */
const SEAT_KINDS = [['', 'Human'], ['random', 'Bot: random profile'], ...PROFILES.map((p) => [p, `Bot: ${PROFILE_LABELS[p] ?? p}`])];

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
  /** Each seat: '' for a human, else a bot profile or 'random'. @type {string[]} */
  botSeats: DEFAULT_SEATS.map(() => ''),
};

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
      <span class="player-status">${player.bot ? `bot · ${esc(PROFILE_LABELS[player.profile ?? ''] ?? player.profile ?? 'goal')}` : player.online ? 'connected' : 'away'}</span>
    </div>`);
  $('status').innerHTML = `<p>Round <b>${status.round}</b> — <b>${esc(status.phase)}</b> · ${esc(optionsLabel(status.options))}</p><div class="player-list">${players.join('')}</div>`;
}

function renderSeats() {
  $('seats').innerHTML = host.seats.map((name, idx) => `
    <div class="inline">
      <input type="text" class="grow" data-seat="${idx}" value="${esc(name)}" maxlength="20" placeholder="Seat ${idx + 1}" aria-label="Seat ${idx + 1} name">
      <select data-bot="${idx}" aria-label="Seat ${idx + 1} player">${SEAT_KINDS.map(([id, label]) => `<option value="${id}" ${host.botSeats[idx] === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
      <button class="btn" type="button" data-action="remove-seat" data-seat="${idx}" ${host.seats.length <= MIN_SEATS ? 'disabled' : ''}>Remove</button>
    </div>`).join('');
  $('deal-note').textContent = host.status?.hasGame && host.status.phase !== 'ended' ? 'A game is in progress; dealing replaces it.' : '';
}

/** One radio group per variant in spec.json; empty until candidate rules become variants. */
function renderOptions() {
  $('options').innerHTML = variants.map((variant) => `
    <fieldset class="option-choice">
      <legend class="small muted">${esc(variant.label)}</legend>
      ${variant.choices.map((choice) => `
        <label class="inline"><input type="radio" name="option-${esc(variant.id)}" value="${esc(choice.id)}" ${choice.id === variant.default ? 'checked' : ''}> <span><b>${esc(choice.label)}</b> — ${esc(choice.description)}</span></label>`).join('')}
    </fieldset>`).join('');
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
      host.botSeats = host.seats.map((seat) => (host.status?.bots?.includes(seat) ? host.status.botProfiles?.[seat] ?? 'goal' : ''));
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
    const checked = /** @type {HTMLInputElement | null} */ (document.querySelector(`input[name="option-${variant.id}"]:checked`));
    return [variant.id, checked?.value ?? variant.default];
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
  const botProfiles = Object.fromEntries(players.map((id, idx) => [id, kinds[idx]]).filter(([, kind]) => kind));
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
    return renderSeats();
  }
  if (action === 'remove-seat') {
    const removed = Number(target.dataset.seat);
    host.seats = readSeatNames().filter((_, idx) => idx !== removed);
    host.botSeats = readBotSeats().filter((_, idx) => idx !== removed);
    return renderSeats();
  }
}

function main() {
  document.addEventListener('click', onClick);
  $('key-form').addEventListener('submit', onUnlock);
  $('deal-form').addEventListener('submit', onDeal);
  renderOptions();
  render();
  void refresh(); // open servers answer without a key; locked ones show the key panel
}

main();
