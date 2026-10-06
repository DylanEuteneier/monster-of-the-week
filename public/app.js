// @ts-check
/**
 * Monster of the Week — the table. Renders one player's view and sends moves.
 *
 * The client never decides anything: every move round-trips to the Durable
 * Object. The engine is imported only for previews and derived values.
 *
 * The first draft (Appendix G): the island with its pieces, each player's
 * standing, and one panel per phase (draft, play, growth, the end). Targets
 * are chosen from a list of legal options for now; choosing them on the board
 * (with the candidate states) comes next.
 */
import { spec, factionById, locationById, cardById, waitingOn, sampleTarget, describeTarget } from './engine.js';
import art from './assets/sprites.json' with { type: 'json' };
import { SEAT_COLOURS, tokenHtml, cubeHtml, hexHtml } from './pieces.js';

/** @typedef {import('./engine.js').PlayerView} PlayerView */
/** @typedef {import('./engine.js').Move} Move */
/** @typedef {{ from: string, text: string, at: number }} ChatLine */

const PALETTE = SEAT_COLOURS;   // seat colours match the influence cubes
const SPRITES = /** @type {Record<string, { width: number, height: number, src: string }>} */ (art.sprites);
const HEXES = /** @type {Record<string, { width: number, height: number, src: string }>} */ (art.hexes ?? {});
const TOAST_MS = 4000;
const RECONNECT_MS = 2000;
const HOST_KEY_STORAGE = 'motw-host-key';

// ---------------------------------------------------------------------------
// Client state
// ---------------------------------------------------------------------------

const ui = {
  token: location.pathname.startsWith('/p/') ? location.pathname.slice(3) : '',
  /** Hotseat: one tab plays every human seat. Tokens come from the admin API with the host key. */
  hotseat: {
    enabled: location.pathname === '/hotseat',
    /** @type {{ player: string, token: string }[]} */
    seats: [],
    follow: true,
    /** set while we deliberately close a socket to switch seats, so the close handler does not reconnect */
    switching: false,
  },
  /** @type {string[]} */
  bots: [],
  /** @type {PlayerView | null} */
  view: null,
  /** @type {string[]} */
  online: [],
  /** @type {ChatLine[]} */
  chat: [],
  /** @type {WebSocket | null} */
  socket: null,
  connectionNote: 'Connecting…',
  /** round:phase; unsent choices reset when it changes */
  phaseKey: '',
  /** @type {{ text: string, kind: 'error' | 'info' } | null} */
  toast: null,
  /** draft: cards ticked to keep */
  /** @type {string[]} */
  keep: [],
  /** play: the card whose targets are on show */
  /** @type {string | null} */
  choosing: null,
  /** @type {import('./engine.js').Target[]} */
  options: [],
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** @param {unknown} value */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

/** @param {string} id */
function $(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element;
}

/**
 * A sprite from public/assets/ at a whole-number scale, or '' if it isn't drawn yet.
 * @param {string} id
 * @param {number} scale
 */
function spriteImg(id, scale) {
  const sprite = SPRITES[id];
  if (!sprite) return '';
  return `<img class="sprite" src="${esc(sprite.src)}" width="${sprite.width * scale}" height="${sprite.height * scale}" alt="">`;
}

/** @param {string} playerId */
function colourOf(playerId) {
  const idx = ui.view?.seating.indexOf(playerId) ?? 0;
  return PALETTE[Math.max(idx, 0) % PALETTE.length];
}

/** @param {string} text @param {'error' | 'info'} [kind] */
function toast(text, kind = 'error') {
  ui.toast = { text, kind };
  renderToast();
  setTimeout(() => {
    if (ui.toast?.text === text) {
      ui.toast = null;
      renderToast();
    }
  }, TOAST_MS);
}

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}/ws/${ui.token}`);
  ui.socket = socket;
  socket.addEventListener('open', () => {
    ui.connectionNote = '';
    render();
  });
  socket.addEventListener('message', (event) => handleServerMessage(String(event.data)));
  socket.addEventListener('close', (event) => handleClose(event));
}

/** @param {CloseEvent} event */
function handleClose(event) {
  ui.socket = null;
  if (ui.hotseat.switching) return;
  const permanent = event.code === 4000 || event.code === 4001 || event.code === 1008;
  ui.connectionNote = permanent ? `Disconnected: ${event.reason || 'this link is no longer valid'}` : 'Reconnecting…';
  render();
  if (!permanent) setTimeout(connect, RECONNECT_MS);
}

/** @param {string} raw */
function handleServerMessage(raw) {
  const message = JSON.parse(raw);
  if (message.type === 'state') {
    ui.bots = message.bots ?? [];
    return receiveState(message.view, message.online);
  }
  if (message.type === 'presence') {
    ui.online = message.online;
    return renderPlayers();
  }
  if (message.type === 'chat') return receiveChat(message.lines, message.reset === true);
  if (message.type === 'error') return toast(message.reason);
}

/** @param {PlayerView} view @param {string[]} online */
function receiveState(view, online) {
  ui.view = view;
  ui.online = online;
  const phaseKey = `${view.round}:${view.phase}`;
  if (phaseKey !== ui.phaseKey) resetDrafts(phaseKey);
  render();
  followTheAction(view);
}

/** Clear the player's unsent choices; add fields here as real phases land. @param {string} phaseKey */
function resetDrafts(phaseKey) {
  ui.phaseKey = phaseKey;
  ui.keep = [];
  ui.choosing = null;
  ui.options = [];
}

/** @param {ChatLine[]} lines @param {boolean} reset */
function receiveChat(lines, reset) {
  ui.chat = [...(reset ? [] : ui.chat), ...lines].slice(-100);
  renderChat();
}

/** @param {Move} move */
function sendMove(move) {
  if (!ui.socket || ui.socket.readyState !== WebSocket.OPEN) return toast('Not connected');
  ui.socket.send(JSON.stringify({ type: 'move', move }));
}

/** @param {string} text */
function sendChat(text) {
  if (!ui.socket || ui.socket.readyState !== WebSocket.OPEN) return toast('Not connected');
  ui.socket.send(JSON.stringify({ type: 'chat', text }));
}

// ---------------------------------------------------------------------------
// Rendering — header and seats
// ---------------------------------------------------------------------------

/** @type {Record<PlayerView['phase'], string>} */
const PHASE_LABELS = { draft: 'Draft', play: 'Play', growth: 'Growth', ended: 'Game over' };

const SUIT = new Map(spec.archetypes.map((a) => [a.id, a.symbol]));
/** @param {string} f */
const fname = (f) => factionById(f).name;

function renderHeader() {
  const view = ui.view;
  const status = view ? `Round ${view.round} of ${view.rounds} — ${PHASE_LABELS[view.phase]}` : ui.connectionNote;
  const you = view ? `<span class="row"><span class="swatch" style="height:12px;background:${colourOf(view.you)}"></span> ${esc(view.you)}</span>` : '';
  $('header').innerHTML = `
    <h1>MONSTER OF THE WEEK</h1>
    <span class="phase-label">${esc(status)}</span>
    ${you}
    <span class="muted small">${esc(ui.connectionNote)}</span>`;
}

/** @param {string} playerId */
function playerStatus(playerId) {
  const view = ui.view;
  if (!view) return '';
  if (view.phase === 'draft') return view.players[playerId].picked ? 'picked' : 'picking…';
  if (view.phase === 'ended') return view.result?.players.includes(playerId) ? 'wins' : '';
  return waitingOn(view).includes(playerId) ? 'to act' : `${view.players[playerId].handSize} cards`;
}

function renderPlayers() {
  const view = ui.view;
  if (!view) return;
  const rows = view.seating.map((id) => {
    const p = view.players[id];
    const group = spec.slayerGroups.find((g) => g.id === p.group);
    const standing = view.factions.filter((f) => p.standing[f]).map((f) => `${esc(SUIT.get(factionById(f).archetype) ?? '')} ${p.standing[f]}`).join(' · ');
    return `
      <div class="player ${id === view.you ? 'player-you' : ''}">
        <span class="swatch" style="background:${colourOf(id)}"></span>
        <span class="player-name"><span class="presence ${ui.online.includes(id) ? 'presence-on' : ''}"></span>${esc(id)}${id === view.you ? ' <span class="muted small">(you)</span>' : ''}${ui.bots.includes(id) ? ' <span class="tag">bot</span>' : ''}
          <span class="small muted">${esc(SUIT.get(group?.archetype ?? '') ?? '')} ${esc(group?.name ?? '')}</span>
          <span class="small">standing ${standing || '—'} · supply ${p.supply} · trophies ${p.trophyCount}</span></span>
        <span class="player-status">${esc(playerStatus(id))}</span>
      </div>`;
  });
  $('players').innerHTML = `<h2>Slayer groups</h2><div class="player-list">${rows.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Rendering — the island
// ---------------------------------------------------------------------------

/** @param {string} loc */
function piecesAt(loc) {
  const view = /** @type {PlayerView} */ (ui.view);
  const place = view.board[loc];
  const tokens = Object.entries(place.cubes).map(([f, n]) => `<span class="piece">${tokenHtml(f, 1)}<b>${n}</b></span>`).join('');
  const cubes = Object.entries(place.influence).filter(([, n]) => n > 0)
    .map(([pid, n]) => `<span class="piece">${cubeHtml(colourOf(pid), 8)}<b>${n}</b></span>`).join('');
  const token = place.token ? `<span class="tag" style="border-color:${colourOf(place.token.owner)}">token</span>` : '';
  return `<div class="stack-row">${tokens}</div><div class="cube-row">${cubes}${token}</div>`;
}

function renderBoard() {
  const view = ui.view;
  if (!view) return;
  const board = /** @type {{ width: number, height: number, src: string, tiles: { loc: string, region: string, x: number, y: number }[] } | undefined} */ (art.board);
  const S = 2;
  const tiles = (board?.tiles ?? []).map((t) => {
    const place = view.board[t.loc];
    return `<div class="board-tile${place.scorched ? ' is-scorched' : ''}" title="${esc(locationById(t.loc).name)} · ${esc(t.region)}" style="position:absolute;left:${t.x * S}px;top:${t.y * S}px">${hexHtml(t.loc, S, place.scorched ? '<b>scorched</b>' : piecesAt(t.loc))}</div>`;
  });
  const presence = view.factions.map((f) => Object.values(view.board).reduce((n, pl) => n + (pl.cubes[f] ?? 0), 0));
  const total = presence.reduce((a, b) => a + b, 0);
  const factions = view.factions.map((f, i) => `<span class="faction-chip">${tokenHtml(f, 1)} ${esc(fname(f))} <b>${presence[i]}</b> <span class="muted small">supply ${view.supply[f]}</span></span>`).join('');
  $('board').innerHTML = `
    <h2>The island</h2>
    <p class="small">Total presence <b>${total}</b> · the invaders win if it is more than <b>${esc(view.options.threshold)}</b> at the end.</p>
    <div class="inline">${factions}</div>
    ${board ? `<div class="board" style="width:${board.width * S}px;height:${board.height * S}px"><img class="sprite" src="${esc(board.src)}" width="${board.width * S}" height="${board.height * S}" alt="The island" style="position:absolute;left:0;top:0">${tiles.join('')}</div>` : ''}`;
}

// ---------------------------------------------------------------------------
// Rendering — cards and the phase panel
// ---------------------------------------------------------------------------

/** @param {string} id @param {string} [actions] @param {boolean} [ticked] */
function cardHtml(id, actions = '', ticked = false) {
  const c = cardById(id);
  const head = c.suit ? `${esc(SUIT.get(c.suit) ?? '')} ${esc(c.slot)} · influence ${c.influence}` : `${c.marked ? `marked ${esc(c.marked)}` : 'unsuited'}`;
  return `<div class="card ${ticked ? 'card-ticked' : ''}" data-card="${esc(id)}">
    <div class="small muted">${head}</div>
    <b>${esc(c.name)}</b>
    <p class="small">${esc(c.text)}</p>
    ${c.response ? `<p class="small"><b>Response (${esc(c.response.timing)}): ${esc(c.response.name)}.</b> ${esc(c.response.text)}</p>` : ''}
    ${actions}
  </div>`;
}

function renderPhase() {
  const view = ui.view;
  if (!view) {
    if (ui.hotseat.enabled) return renderHotseatEmpty();
    $('phase').innerHTML = ui.token ? `<h2>Table</h2><p class="muted">${esc(ui.connectionNote)}</p>` : '<h2>No seat</h2><p>Open the player link you were given (it looks like <span class="mono">/p/…</span>).</p>';
    return;
  }
  const renderers = { draft: renderDraft, play: renderPlay, growth: renderGrowth, ended: renderEnded };
  $('phase').innerHTML = renderers[view.phase]();
}

/** @param {string} label */
function waitingFor(label) {
  const view = ui.view;
  if (!view) return '';
  const pending = waitingOn(view);
  return `<div class="notice">${label} Waiting for ${pending.map((id) => `<b>${esc(id)}</b>`).join(', ') || 'nobody'}.</div>`;
}

function renderDraft() {
  const view = /** @type {PlayerView} */ (ui.view);
  const me = view.me;
  if (me.picked) return `<h2>Draft</h2>${waitingFor('You have picked.')}<div class="cards">${me.kept.map((c) => cardHtml(c)).join('')}</div>`;
  const need = me.kept.length + 1;
  const pool = [...me.kept, ...me.batch];
  ui.keep = ui.keep.filter((c) => pool.includes(c));
  return `<h2>Draft</h2>
    <p class="small">Keep <b>${need}</b> of these: your kept cards rejoin the batch each pass (DR3). ${ui.keep.length}/${need} chosen.</p>
    <div class="cards">${pool.map((c) => cardHtml(c, '', ui.keep.includes(c))).join('')}</div>
    <button class="btn btn-primary" data-action="pick" ${ui.keep.length === need ? '' : 'disabled'}>Keep these</button>`;
}

function renderPlay() {
  const view = /** @type {PlayerView} */ (ui.view);
  const me = view.me;
  const pending = view.pending;
  const responses = me.hand.filter((c) => cardById(c).response);
  const respondBar = responses.length ? `<div class="stack"><b class="small">Responses (play at any time)</b>${responses.map((c) => {
    const r = /** @type {NonNullable<ReturnType<typeof cardById>['response']>} */ (cardById(c).response);
    const where = r.trigger === 'move-into-your-location' && pending?.target ? Object.keys(view.board).filter((l) => (view.board[l].influence[view.you] ?? 0) > 0) : [];
    return where.length
      ? where.map((l) => `<button class="btn" data-action="respond" data-card="${esc(c)}" data-location="${esc(l)}">${esc(r.name)}: ${esc(locationById(l).name)}</button>`).join('')
      : `<button class="btn" data-action="respond" data-card="${esc(c)}">${esc(r.name)}</button>`;
  }).join('')}</div>` : '';
  if (pending) {
    const line = `<p><b>${esc(pending.player)}</b> plays <b>${esc(cardById(pending.card).name)}</b>: ${esc(describeTarget(pending.card, pending.target))}${pending.cancelled ? ' (cancelled)' : ''}${pending.blocked.length ? ` · blocked: ${pending.blocked.map((l) => esc(locationById(l).name)).join(', ')}` : ''}</p>`;
    return `<h2>Play</h2>${line}${pending.player === view.you ? '<button class="btn btn-primary" data-action="confirm">Confirm</button>' : waitingFor('Answer with a response now, or let it resolve.')}${respondBar}`;
  }
  if (view.toAct !== view.you) return `<h2>Play</h2>${waitingFor('')}<div class="cards">${me.hand.map((c) => cardHtml(c)).join('')}</div>${respondBar}`;
  if (ui.choosing) {
    const opts = ui.options.map((t, i) => `<button class="btn" data-action="target" data-index="${i}">${esc(describeTarget(/** @type {string} */ (ui.choosing), t))}</button>`).join('');
    return `<h2>Play</h2><p>Choose a target for <b>${esc(cardById(ui.choosing).name)}</b>:</p><div class="stack">${opts || '<span class="muted small">No legal target found.</span>'}
      <button class="btn" data-action="target-none">Play it for no effect</button><button class="btn" data-action="more-targets">Show other targets</button><button class="btn" data-action="back">Back</button></div>`;
  }
  const mustOpen = view.first === view.you && !view.opened && me.hand.some((c) => cardById(c).marked);
  const buttons = (/** @type {string} */ c) => {
    const card = cardById(c);
    return `<div class="inline">${card.action ? `<button class="btn btn-primary" data-action="act" data-card="${esc(c)}">Action</button>` : ''}${card.suit && !mustOpen ? `<button class="btn" data-action="influence" data-card="${esc(c)}">Influence +${card.influence}</button>` : ''}</div>`;
  };
  return `<h2>Your turn</h2>${mustOpen ? '<p class="small">You go first: open with your marked card.</p>' : ''}
    <div class="cards">${me.hand.map((c) => cardHtml(c, buttons(c))).join('')}</div>
    <button class="btn" data-action="pass">Pass</button>${respondBar}`;
}

function renderGrowth() {
  const view = /** @type {PlayerView} */ (ui.view);
  const g = view.growing;
  if (!g) return '<h2>Growth</h2>';
  const mine = g.leaders[g.next % g.leaders.length] === view.you;
  const spots = Object.keys(g.due).map((l) => `<button class="btn" data-action="grow" data-location="${esc(l)}">${esc(locationById(l).name)}</button>`).join('');
  return `<h2>Growth</h2><p>${esc(fname(g.faction))} is short of cubes and grows as far as its supply allows; its influence leaders choose where.</p>${mine ? `<div class="inline">${spots}</div>` : waitingFor('')}`;
}

function renderEnded() {
  const view = /** @type {PlayerView} */ (ui.view);
  const r = view.result;
  if (!r) return '<h2>Game over</h2>';
  const side = r.side === 'island' ? 'The island wins.' : `The invaders win: ${r.factions.map(fname).join(' and ')}.`;
  const scores = view.seating.map((id) => `<li>${esc(id)}: ${r.scores[id]}${r.players.includes(id) ? ' <b>(winner)</b>' : ''}</li>`).join('');
  return `<h2>Game over</h2><p>${esc(side)}</p><ul>${scores}</ul>`;
}

// ---------------------------------------------------------------------------
// Rendering — log, chat, toast
// ---------------------------------------------------------------------------

function renderLog() {
  const view = ui.view;
  if (!view) return;
  const rounds = view.log.slice().reverse().map((entry) => `<div class="log-round">${entry.events.map((line) => `<span>${esc(line)}</span>`).join('')}</div>`);
  $('log').innerHTML = `<h2>Log</h2>${rounds.join('') || '<p class="muted small">Nothing has resolved yet.</p>'}`;
}

function renderChat() {
  const lines = ui.chat.map((line) => `<div class="chat-line"><b style="color:${colourOf(line.from)}">${esc(line.from)}</b> ${esc(line.text)}</div>`);
  const box = $('chat-lines');
  box.innerHTML = lines.join('');
  box.scrollTop = box.scrollHeight;
}

function renderToast() {
  const element = $('toast');
  element.hidden = ui.toast === null;
  element.textContent = ui.toast?.text ?? '';
  element.className = `toast ${ui.toast?.kind === 'info' ? 'info' : ''}`;
}

function render() {
  renderHeader();
  renderPhase();
  if (!ui.view) return;
  renderPlayers();
  renderBoard();
  renderLog();
}

// ---------------------------------------------------------------------------
// Hotseat — one tab, every human seat
// ---------------------------------------------------------------------------

/** @param {{ needKey: boolean }} state */
function renderHotseatEmpty(state = { needKey: false }) {
  $('phase').innerHTML = state.needKey
    ? `<h2>Hotseat</h2><p class="small">This server is locked. Enter the host key to load every seat into this tab.</p>
       <form class="inline" id="hotseat-key-form"><input type="password" id="hotseat-key" placeholder="host key" aria-label="Host key"><button class="btn btn-primary" type="submit">Unlock</button></form>`
    : `<h2>Hotseat</h2><p class="muted">${esc(ui.connectionNote || 'Loading seats…')}</p>`;
  document.getElementById('hotseat-key-form')?.addEventListener('submit', onHotseatKey);
}

/** @param {SubmitEvent} event */
function onHotseatKey(event) {
  event.preventDefault();
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById('hotseat-key'));
  const key = input?.value.trim();
  if (!key) return;
  sessionStorage.setItem(HOST_KEY_STORAGE, key);
  void loadHotseat();
}

async function loadHotseat() {
  const key = sessionStorage.getItem(HOST_KEY_STORAGE);
  /** @type {HeadersInit} */
  const headers = key ? { authorization: `Bearer ${key}` } : {};
  try {
    const [links, status] = await Promise.all([fetch('/admin/links', { headers }), fetch('/admin/status', { headers })]);
    if (links.status === 401) {
      if (key) toast('That host key was not accepted');
      sessionStorage.removeItem(HOST_KEY_STORAGE);
      return renderHotseatEmpty({ needKey: true });
    }
    if (!links.ok) throw new Error((await links.json()).error ?? `${links.status}`);
    const body = /** @type {{ links: { player: string, url: string }[] }} */ (await links.json());
    const bots = /** @type {{ bots?: string[] }} */ (status.ok ? await status.json() : {}).bots ?? [];
    ui.hotseat.seats = body.links.filter((link) => !bots.includes(link.player)).map((link) => ({ player: link.player, token: link.url.split('/p/')[1] ?? '' }));
    ui.bots = bots;
    renderSeatbar();
    if (ui.hotseat.seats.length) switchSeat(ui.hotseat.seats[0].player);
  } catch (error) {
    ui.connectionNote = error instanceof Error ? error.message : String(error);
    renderHotseatEmpty({ needKey: false });
  }
}

/** @param {string} player */
function switchSeat(player) {
  const seat = ui.hotseat.seats.find((candidate) => candidate.player === player);
  if (!seat || seat.token === ui.token) return;
  ui.hotseat.switching = true;
  ui.socket?.close(1000, 'switching seat');
  ui.hotseat.switching = false;
  ui.socket = null;
  ui.token = seat.token;
  ui.view = null;
  ui.phaseKey = '';
  ui.connectionNote = `Connecting as ${player}…`;
  renderSeatbar();
  connect();
}

/** Who needs to act next, from a view anyone at the table can see. @param {PlayerView} view */
function whoShouldAct(view) {
  return waitingOn(view).find((id) => !ui.bots.includes(id)) ?? null;
}

/** @param {PlayerView} view */
function followTheAction(view) {
  if (!ui.hotseat.enabled) return;
  renderSeatbar();
  if (!ui.hotseat.follow) return;
  const next = whoShouldAct(view);
  if (next && next !== view.you && ui.hotseat.seats.some((seat) => seat.player === next)) switchSeat(next);
}

function renderSeatbar() {
  const bar = $('seatbar');
  bar.hidden = !ui.hotseat.enabled;
  if (!ui.hotseat.enabled) return;
  const acting = ui.view ? whoShouldAct(ui.view) : null;
  const seats = ui.hotseat.seats.map((seat) => {
    const isYou = seat.token === ui.token;
    return `<button class="btn seat ${isYou ? 'btn-active' : ''}" data-action="switch-seat" data-player="${esc(seat.player)}" style="border-left: 4px solid ${colourOf(seat.player)}">${esc(seat.player)}${acting === seat.player ? ' <span class="tag">to act</span>' : ''}</button>`;
  });
  bar.innerHTML = `<span class="small muted">Hotseat</span>${seats.join('')}
    <label class="inline small"><input type="checkbox" data-action="toggle-follow" ${ui.hotseat.follow ? 'checked' : ''}> follow the action</label>
    ${ui.bots.length ? `<span class="small muted">bots: ${ui.bots.map(esc).join(', ')}</span>` : ''}`;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

/** @param {MouseEvent} event */
function onClick(event) {
  const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null);
  if (!target) return;
  const action = target.dataset.action;
  const view = ui.view;
  const card = target.dataset.card ?? '';
  if (action === 'pick') return sendMove({ type: 'pick', keep: ui.keep.slice() });
  if (action === 'pass') return sendMove({ type: 'pass' });
  if (action === 'confirm') return sendMove({ type: 'confirm' });
  if (action === 'influence') return sendMove({ type: 'play', card, use: 'influence' });
  if (action === 'respond') return sendMove({ type: 'respond', card, location: target.dataset.location });
  if (action === 'grow') return sendMove({ type: 'grow', location: target.dataset.location ?? '' });
  if ((action === 'act' || action === 'more-targets') && view) {
    ui.choosing = action === 'act' ? card : ui.choosing;
    ui.options = targetOptions(view, /** @type {string} */ (ui.choosing));
    return renderPhase();
  }
  if (action === 'target' && ui.choosing) {
    const chosen = ui.options[Number(target.dataset.index)];
    const id = ui.choosing;
    ui.choosing = null;
    return sendMove({ type: 'play', card: id, use: 'action', target: chosen });
  }
  if (action === 'target-none' && ui.choosing) {
    const id = ui.choosing;
    ui.choosing = null;
    return sendMove({ type: 'play', card: id, use: 'action', target: null });
  }
  if (action === 'back') {
    ui.choosing = null;
    return renderPhase();
  }
  if (action === 'switch-seat') {
    ui.hotseat.follow = false;
    switchSeat(target.dataset.player ?? '');
    return renderSeatbar();
  }
  if (action === 'toggle-follow') {
    ui.hotseat.follow = target instanceof HTMLInputElement ? target.checked : !ui.hotseat.follow;
    if (ui.view) followTheAction(ui.view);
  }
}

/** A handful of distinct legal targets, sampled from the view (the server checks the move). @param {PlayerView} view @param {string} cardId */
function targetOptions(view, cardId) {
  /** @type {Map<string, import('./engine.js').Target>} */
  const seen = new Map();
  for (let i = 0; i < 60 && seen.size < 8; i++) {
    const t = sampleTarget(/** @type {any} */ ({ ...view, players: { ...view.players, [view.you]: { ...view.players[view.you] } } }), view.you, cardId, Math.random);
    if (t) seen.set(JSON.stringify(t), t);
  }
  return [...seen.values()];
}

/** Draft: tick or untick a card to keep. @param {MouseEvent} event */
function onCardClick(event) {
  const el = event.target instanceof HTMLElement ? event.target.closest('[data-card]') : null;
  if (!el || !ui.view || ui.view.phase !== 'draft' || ui.view.me.picked || (event.target instanceof HTMLElement && event.target.closest('[data-action]'))) return;
  const id = /** @type {HTMLElement} */ (el).dataset.card ?? '';
  ui.keep = ui.keep.includes(id) ? ui.keep.filter((c) => c !== id) : [...ui.keep, id];
  renderPhase();
}

/** @param {SubmitEvent} event */
function onChatSubmit(event) {
  event.preventDefault();
  const input = /** @type {HTMLInputElement} */ ($('chat-input'));
  const text = input.value.trim();
  if (!text) return;
  sendChat(text);
  input.value = '';
}

function main() {
  document.addEventListener('click', onClick);
  document.addEventListener('click', onCardClick);
  $('chat-form').addEventListener('submit', onChatSubmit);
  render();
  if (ui.hotseat.enabled) return void loadHotseat();
  if (ui.token) connect();
}

main();
