// @ts-check
/**
 * Monster of the Week — the table. Renders one player's view and sends moves.
 *
 * The client never decides anything: every move round-trips to the Durable
 * Object. The engine is imported only for previews and derived values.
 *
 * The first draft (Appendix G): the island with its pieces, each player's
 * standing, and one panel per phase (draft, play, growth, the end). Targets
 * are chosen on the board one step at a time: each step's candidates are
 * spotlit (hexes) or lit gold (tokens), and the server checks the result.
 */
import { spec, factionById, locationById, cardById, waitingOn, describeTarget, nextChoice, pendingDestinations } from './engine.js';
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
  /** play: the card whose target is being built on the board */
  /** @type {string | null} */
  choosing: null,
  /** @type {import('./engine.js').Target} */
  target: {},
  /** table talk lines arrived while the overlay was closed */
  unread: 0,
  /** a response waiting for its location to be clicked (Never Invite Them In) */
  /** @type {string | null} */
  responding: null,
  /** draft: how many cards were kept when ui.keep was last reset */
  keepFor: -1,
  /** the phone map window has been centred once */
  boardCentred: false,
  /** a side stack opened by a tap: 'influence', 'score' or null */
  /** @type {string | null} */
  sideOpen: null,
  /** the slayer group card open in the accordion (null: your own) */
  /** @type {string | null} */
  expanded: null,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** @param {unknown} value */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

/** Last HTML written to each panel, so unchanged panels aren't rebuilt. @type {Map<string, string>} */
const written = new Map();

/** Replace a panel's HTML only if it changed (rebuilding hundreds of pieces is costly). @param {string} id @param {string} html */
function setHtml(id, html) {
  if (written.get(id) === html) return;
  written.set(id, html);
  $(id).innerHTML = html;
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
  ui.target = {};
  ui.responding = null;
  ui.keepFor = -1;
}

/** @param {ChatLine[]} lines @param {boolean} reset */
function receiveChat(lines, reset) {
  ui.chat = [...(reset ? [] : ui.chat), ...lines].slice(-100);
  const open = !document.getElementById('chat-overlay')?.hidden;
  if (!reset && !open) ui.unread += lines.length;
  renderChat();
  renderUnread();
}

/** The unread count on the table talk button. */
function renderUnread() {
  const badge = document.getElementById('chat-unread');
  if (!badge) return;
  badge.hidden = ui.unread === 0;
  badge.textContent = String(ui.unread);
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

const SYMBOLS = /** @type {Record<string, { width: number, height: number, src: string }>} */ (art.symbols ?? {});
/** An archetype's pixel symbol (the art on the hexes), or '' if not drawn. @param {string | null | undefined} archetype @param {number} [scale] */
function suitIcon(archetype, scale = 2) {
  const s = archetype ? SYMBOLS[archetype] : undefined;
  return s ? `<img class="sprite suit-icon" src="${esc(s.src)}" width="${s.width * scale}" height="${s.height * scale}" alt="">` : '';
}
/** @param {string} f */
const fname = (f) => factionById(f).name;

function renderHeader() {
  const view = ui.view;
  const status = view ? `Round ${view.round} of ${view.rounds} — ${PHASE_LABELS[view.phase]}` : ui.connectionNote;
  const you = view ? `<span class="row"><span class="swatch" style="height:12px;background:${colourOf(view.you)}"></span> ${esc(view.you)}</span>` : '';
  setHtml('header', `
    <h1>MONSTER OF THE WEEK</h1>
    <span class="phase-label">${esc(status)}</span>
    ${you}
    <span class="muted small">${esc(ui.connectionNote)}</span>`);
}

/** @param {string} playerId */
function playerStatus(playerId) {
  const view = ui.view;
  if (!view) return '';
  if (view.phase === 'draft') return view.players[playerId].picked ? 'picked' : 'picking…';
  if (view.phase === 'ended') return view.result?.players.includes(playerId) ? 'wins' : '';
  return waitingOn(view).includes(playerId) ? 'to act' : '';
}

/** Cards in hand as little card backs, one each. @param {number} n */
function miniCards(n) {
  return n > 0 ? `<span class="mini-cards" title="${n} card${n === 1 ? '' : 's'} in hand">${'<span class="mini-card"></span>'.repeat(n)}</span>` : '';
}

/** The slayer groups: a horizontal accordion, one card open at a time (yours by default). */
function renderPlayers() {
  const view = ui.view;
  if (!view) return;
  const open = ui.expanded && view.seating.includes(ui.expanded) ? ui.expanded : view.you;
  const rows = view.seating.map((id) => {
    const p = view.players[id];
    const group = spec.slayerGroups.find((g) => g.id === p.group);
    const isOpen = id === open;
    const trophies = view.factions.filter((f) => view.me.trophies[f]).map((f) => Array.from({ length: view.me.trophies[f] }, () => tokenHtml(f, 1)).join('')).join('');
    const row = (/** @type {string} */ label, /** @type {string} */ value) => `<span class="player-row"><span class="field-label">${label}</span><span class="field-value">${value}</span></span>`;
    const rows = [
      row('Group', `${suitIcon(group?.archetype)} ${esc(group?.name ?? '')}`),
      row('Supply', `<span class="supply-row cubes" title="${p.supply} in supply">${Array.from({ length: p.supply }, () => cubeHtml(colourOf(id), 8)).join('')}</span>`),
      row('Hand', miniCards(p.handSize) || '<span class="muted">empty</span>'),
      id === view.you ? row('Trophies', `<span class="trophies" title="Secret: only you see these (IN2)">${trophies || '<span class="muted">none yet</span>'}</span>`) : '',
    ].join('');
    return `
      <div class="player ${id === view.you ? 'player-you' : ''} ${isOpen ? 'is-open' : ''}" data-action="expand-player" data-player="${esc(id)}" aria-expanded="${isOpen}" style="--seat:${colourOf(id)}">
        <span class="player-row player-head"><span class="player-name"><span class="presence ${ui.online.includes(id) ? 'presence-on' : ''}"></span>${esc(id)}${id === view.you ? ' <span class="muted small">(you)</span>' : ''}${ui.bots.includes(id) ? ' <span class="tag">bot</span>' : ''}</span><span class="player-status">${esc(playerStatus(id))}${miniCards(p.handSize)}</span></span>
        <span class="player-supply-mini" title="${p.supply} in supply">${Array.from({ length: p.supply }, () => cubeHtml(colourOf(id), 7)).join('')}</span>
        <span class="player-detail" aria-hidden="${!isOpen}">${rows}</span>
      </div>`;
  });
  setHtml('players', `<h2>Slayer groups</h2><div class="player-list accordion">${rows.join('')}</div>`);
}

// ---------------------------------------------------------------------------
// Rendering — the island
// ---------------------------------------------------------------------------

/** @typedef {import('./engine.js').Target} Target */

/** The step being chosen, if a target is being built. @param {Target} [t] */
function currentChoice(t = ui.target) {
  const view = ui.view;
  if (!view || !ui.choosing) return null;
  return nextChoice(/** @type {any} */ (view), view.you, ui.choosing, t);
}

/**
 * What can be clicked on the board and the faction table right now: places,
 * groups (a faction at a location) and factions. While a suit card's reading
 * is still open, both readings' candidates show at once and the click decides.
 */
function picks() {
  const view = ui.view;
  /** @type {{ spots: string[], groups: { location: string, faction: string }[], factions: string[] }} */
  const out = { spots: [], groups: [], factions: [] };
  if (!view) return out;
  if (view.phase === 'growth' && view.growing && view.growing.leaders[view.growing.next % view.growing.leaders.length] === view.you) {
    out.spots = Object.keys(view.growing.due);
    return out;
  }
  if (ui.responding && view.pending) {
    out.spots = pendingDestinations(/** @type {any} */ (view), view.pending).filter((l) => (view.board[l].influence[view.you] ?? 0) > 0 && !view.pending?.blocked.includes(l));
    return out;
  }
  const choice = currentChoice();
  if (!choice) return out;
  const steps = choice.kind === 'mode' ? [] : [choice];
  for (const c of steps) {
    if (!c) continue;
    if (c.kind === 'location' || c.kind === 'split') out.spots.push(...c.options);
    if (c.kind === 'group') out.groups.push(...c.options);
    if (c.kind === 'faction') out.factions.push(...c.options);
  }
  return out;
}

/**
 * The pieces on one hex, as repeated pieces in rows: each faction's tokens in
 * its own row (a location holds at most two factions, LL1), then the
 * players' influence cubes. A candidate group's row is lit and clickable, and
 * so is every group of a candidate faction.
 * @param {string} loc @param {ReturnType<typeof picks>} lit
 */
function piecesAt(loc, lit) {
  const view = /** @type {PlayerView} */ (ui.view);
  const place = view.board[loc];
  const rows = Object.entries(place.cubes).filter(([, n]) => n > 0).map(([f, n]) => {
    // A group step lights the group; a faction step lights every group of that faction, and picking one picks the faction.
    const group = lit.groups.some((g) => g.location === loc && g.faction === f);
    const faction = !group && lit.factions.includes(f);
    const action = group ? ` data-action="pick-group" data-location="${esc(loc)}" data-faction="${esc(f)}"` : faction ? ` data-action="pick-faction" data-faction="${esc(f)}"` : '';
    const tokens = Array.from({ length: n }, () => tokenHtml(f, 1, group || faction ? 'candidate' : '')).join('');
    return `<span class="token-stack piece-row"${action} title="${n} ${esc(fname(f))}">${tokens}</span>`;
  });
  const cubes = Object.entries(place.influence).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    .flatMap(([pid, n]) => Array.from({ length: n }, () => cubeHtml(colourOf(pid), 8))).join('');
  const token = place.token ? `<span class="hidden-token" style="--owner:${colourOf(place.token.owner)}" title="a face-down token"></span>` : '';
  return `${rows.join('')}<span class="cube-row piece-row">${cubes}${token}</span>`;
}

/** The faction summaries: one row per faction in play. @param {ReturnType<typeof picks>} lit */
function factionTable(lit) {
  const view = /** @type {PlayerView} */ (ui.view);
  const rows = view.factions.map((f) => {
    const faction = factionById(f);
    const arch = spec.archetypes.find((a) => a.id === faction.archetype);
    const best = Math.max(0, ...view.seating.map((pid) => view.players[pid].standing[f] ?? 0));
    const influence = view.seating.filter((pid) => (view.players[pid].standing[f] ?? 0) > 0)
      .sort((a, b) => view.players[b].standing[f] - view.players[a].standing[f]).map((pid) => {
      const n = view.players[pid].standing[f];
      return `<span class="standing-group${n === best ? ' is-leading' : ''}" title="${esc(pid)}: ${n}">${Array.from({ length: n }, () => cubeHtml(colourOf(pid), 8)).join('')}</span>`;
    }).join('');
    const on = lit.factions.includes(f);
    return `<div class="faction-row${on ? ' is-candidate' : ''}"${on ? ` data-action="pick-faction" data-faction="${esc(f)}"` : ''}>
      <span class="faction-id cell-id">${tokenHtml(f, 2, on ? 'candidate' : '')}<span><b>${esc(faction.name)}</b><span class="small muted suit-line">${suitIcon(arch?.id)} ${esc(arch?.name ?? '')}</span></span></span>
      <span class="faction-cell cell-supply" data-label="Supply"><span class="supply-row" title="${view.supply[f]} in supply">${Array.from({ length: view.supply[f] }, () => tokenHtml(f, 1)).join('')}</span></span>
      <span class="faction-cell cell-influence" data-label="Influence"><span class="standing-row">${influence || '<span class="small muted">—</span>'}</span></span>
    </div>`;
  });
  return `<div class="faction-table">
    <div class="faction-row faction-head small muted"><span>Faction</span><span>Supply</span><span>Influence (players' standing)</span></div>
    ${rows.join('')}</div>`;
}

function renderBoard() {
  const view = ui.view;
  if (!view) return;
  const board = /** @type {{ width: number, height: number, src: string, tiles: { loc: string, region: string, x: number, y: number }[] } | undefined} */ (art.board);
  const S = 2;
  const lit = picks();
  const chosen = new Set([ui.target.location, ui.target.to, ui.target.bluff, ...(ui.target.path ?? []), ...(ui.target.from ?? []), ...Object.keys(ui.target.split ?? {})].filter(Boolean));
  const tiles = (board?.tiles ?? []).map((t) => {
    const place = view.board[t.loc];
    const on = lit.spots.includes(t.loc);
    const state = on ? 'candidate' : ui.choosing && chosen.has(t.loc) ? 'hovered' : '';
    return `<div class="board-tile${place.scorched ? ' is-scorched' : ''}"${on ? ` data-action="pick-location" data-location="${esc(t.loc)}"` : ''} title="${esc(locationById(t.loc).name)} · ${esc(t.region)}" style="position:absolute;left:${t.x * S}px;top:${t.y * S}px">${hexHtml(t.loc, S, place.scorched ? '<b>scorched</b>' : piecesAt(t.loc, lit), /** @type {import('./pieces.js').TargetState} */ (state))}</div>`;
  });
  const total = Object.values(view.board).reduce((n, pl) => n + Object.values(pl.cubes).reduce((a, b) => a + b, 0), 0);
  // Display tables are never narrower than the map (they may be wider).
  if (board) document.documentElement.style.setProperty('--map-width', `${board.width * S}px`);
  // Phones: start the map window centred on the island, once.
  if (board && !ui.boardCentred && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
    const box = /** @type {HTMLElement} */ (document.querySelector('#board .map-window'));
    if (!box || ui.boardCentred || box.scrollWidth <= box.clientWidth) return;
    box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
    ui.boardCentred = true;
  });
  setHtml('factions', `<h2>Factions</h2>
    <p class="small">Total presence <b>${total}</b> · the invaders win if it is more than <b>${esc(view.options.threshold)}</b> at the end of round ${view.rounds}.</p>
    ${factionTable(lit)}`);
  setHtml('board', `
    <h2>The island</h2>
    ${board ? `<div class="map-window"><div class="board" style="width:${board.width * S}px;height:${board.height * S}px"><img class="sprite" src="${esc(board.src)}" width="${board.width * S}" height="${board.height * S}" alt="The island" style="position:absolute;left:0;top:0">${tiles.join('')}</div></div>` : ''}`);
}

// ---------------------------------------------------------------------------
// Rendering — cards and the phase panel
// ---------------------------------------------------------------------------

/**
 * Could this response card fire right now? Mirrors the engine's triggers from
 * the public view; the server has the final say.
 * @param {PlayerView} view @param {string} cardId
 */
function responseReady(view, cardId) {
  const r = cardById(cardId).response;
  if (!r || view.phase !== 'play') return false;
  const pend = view.pending;
  const others = (/** @type {string} */ type) => view.events.some((e) => e.type === type && e.player !== view.you);
  switch (r.trigger) {
    case 'card-played': return !!pend && pend.player !== view.you && !pend.cancelled;
    case 'move-into-your-location': return !!pend && pend.player !== view.you && !pend.cancelled
      && pendingDestinations(/** @type {any} */ (view), pend).some((l) => (view.board[l].influence[view.you] ?? 0) > 0 && !pend.blocked.includes(l));
    case 'token-placed': return others('token-placed');
    case 'influence-spent': return others('influence-spent');
    case 'influence-placed': return others('influence-placed');
    case 'pass': return others('pass');
    default: return false;
  }
}

/**
 * A card. `mode` says what clicking it does: 'act' (play its action),
 * 'respond' (fire its response), 'keep' (draft), or '' (nothing).
 * @param {string} id @param {{ mode?: '' | 'act' | 'respond' | 'keep', ticked?: boolean, influence?: boolean, dim?: boolean, selected?: boolean, next?: boolean, reading?: string, empty?: string[] }} [o]
 */
function cardHtml(id, o = {}) {
  const c = cardById(id);
  const suit = spec.archetypes.find((a) => a.id === c.suit);
  const view = ui.view;
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
      ${opt('influence', `<b>+${c.influence}</b>`, `Spend for ${c.influence} influence with ${sf ? fname(sf) : `the ${suit?.name ?? ''} faction`}`, false)}
    </div>` : '';
  const classes = ['card', `card-suit-${c.suit ?? 'none'}`, o.ticked ? 'card-ticked' : '', o.mode ? `card-${o.mode}` : '', o.dim ? 'card-dim' : '', o.selected ? 'card-selected' : '', o.selected && o.next ? 'card-needs-reading' : ''].filter(Boolean).join(' ');
  const full = `${c.name}. ${c.text}${c.response ? ` Response (${c.response.timing}): ${c.response.name}. ${c.response.text}` : ''}`;
  return `<div class="${classes}" data-card="${esc(id)}" title="${esc(full)}"${o.mode ? ` data-card-mode="${o.mode}"` : ''}>
    <div class="card-band">${band}</div>
    <div class="card-main">
      <div class="card-text">
        <span class="card-name">${esc(c.name)}</span>
        <p class="small">${esc(c.text)}</p>
        ${readings}
        ${c.response ? `<p class="small card-response"><b>Response, ${esc(c.response.timing)}: ${esc(c.response.name)}.</b> ${esc(c.response.text)}</p>` : ''}
      </div>
      ${options}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// The bottom bar (2026-10-06): one slim bar along the bottom with your
// resources (left), the current step in a few plain words and its buttons
// (middle), and your trophies with a score popover (right). Your hand sits
// above the bar, tops peeking, and rises on hover. The bar's colour shows the
// turn: gold for your move, cyan when you can answer.
// ---------------------------------------------------------------------------

/**
 * What the bar shows, collected while the phase renders.
 * @typedef {{ cards: string[], open: boolean, actions: string[], state: 'turn' | 'respond' | 'wait' | 'end', text: string, extra: string }} BarNext
 */
/** @type {BarNext} */
let handNext = { cards: [], open: false, actions: [], state: 'wait', text: '', extra: '' };

const LABELS = /** @type {Record<string, string>} */ ({ pass: 'Pass', confirm: 'Confirm', withdraw: 'Back', pick: 'Keep', 'target-none': 'No effect', back: 'Back', skip: 'Done' });
const ACTION_ICONS = /** @type {Record<string, string>} */ ({ pass: '»', confirm: '✓', withdraw: '↩', pick: '✓', 'target-none': '⊘', back: '↩', skip: '✓' });
const ARROWS = /** @type {Record<string, string>} */ ({ E: '→', NE: '↗', NW: '↖', W: '←', SW: '↙', SE: '↘' });

/** A labelled button on the bar. @param {string} action @param {{ primary?: boolean, disabled?: boolean, label?: string, tip?: string }} [o] */
function handAction(action, o = {}) {
  const name = o.label ?? LABELS[action];
  const tip = o.tip ? `${name}: ${o.tip}` : name;
  handNext.actions.push(`<button class="bar-btn bar-icon${o.primary ? ' is-primary' : ''}" data-action="${action}" title="${esc(tip)}" aria-label="${esc(name)}"${o.disabled ? ' disabled' : ''}>${ACTION_ICONS[action] ?? esc(name)}</button>`);
  return '';
}

/** Send cards to the hand; `open` raises them all (the draft). @param {string[]} cards @param {boolean} open */
function toHand(cards, open) {
  handNext = { ...handNext, cards, open };
  return '';
}

/** The bar's turn colour, its few words, and anything extra (direction arrows, a count). @param {BarNext['state']} state @param {string} text @param {string} [extra] */
function step(state, text, extra = '') {
  handNext = { ...handNext, state, text, extra };
}

/** Plain words for who is being waited on. */
function waitingText() {
  const view = /** @type {PlayerView} */ (ui.view);
  const others = waitingOn(view).filter((id) => id !== view.you);
  return others.length ? `Waiting for ${others.join(', ')}` : 'Waiting';
}

/** The hand, above the bar. */
function renderHand() {
  const { cards, open } = handNext;
  const n = cards.length;
  const fanned = cards.map((html, i) => html.replace('<div class="card', `<div style="--i:${i};--off:${i - (n - 1) / 2}" class="card`)).join('');
  setHtml('hand', n ? `<div class="fan">${fanned}</div>` : '');
  const el = $('hand');
  el.classList.toggle('is-open', open);
  el.classList.toggle('is-locked', !!ui.choosing || !!ui.responding);
  el.style.setProperty('--n', String(n));
}

/** A small chip: an icon and a number, with a tooltip. @param {string} icon @param {number | string} value @param {string} tip */
const chip = (icon, value, tip) => `<span class="chip" title="${esc(tip)}">${icon}<b>${value}</b></span>`;

/** Your resources, left of the bar: supply, bluffs, and standing with each faction. */
function renderMine() {
  const view = /** @type {PlayerView} */ (ui.view);
  const me = view.players[view.you];
  const standing = view.factions.filter((f) => (me.standing[f] ?? 0) > 0).sort((a, b) => me.standing[b] - me.standing[a])
    .map((f) => `<span class="side-row">${tokenHtml(f, 1)}<b>${me.standing[f]}</b><span class="side-name">${esc(fname(f))}</span></span>`).join('');
  setHtml('mine', `${chip(cubeHtml(colourOf(view.you), 9), me.supply, `Supply: ${me.supply} influence cubes`)}${chip('<span class="bluff"></span>', me.bluffs, `Bluff tokens: ${me.bluffs}`)}`);
  setHtml('influence', `<span class="side-head" data-action="toggle-side" data-side="influence">Influence</span>${standing || '<span class="side-row is-zero"><span class="muted">—</span></span>'}`);
  $('influence').classList.toggle('is-open', ui.sideOpen === 'influence');
}

/** Your trophies (secret): a token and count per faction. */
function renderScore() {
  const view = /** @type {PlayerView} */ (ui.view);
  const t = view.me.trophies;
  setHtml('score', `<span class="side-head">Trophies <span class="muted">(secret)</span></span>${view.factions.map((f) => `<span class="side-row${t[f] ? '' : ' is-zero'}"><span class="side-name">${esc(fname(f))}</span><b>${t[f]}</b>${tokenHtml(f, 1)}</span>`).join('')}`);
  $('score').classList.toggle('is-open', ui.sideOpen === 'score');
}

function renderPhase() {
  handNext = { cards: [], open: false, actions: [], state: 'wait', text: '', extra: '' };
  const view = ui.view;
  if (!view) {
    if (ui.hotseat.enabled) return renderHotseatEmpty();
    setHtml('phase', ui.token ? `<span class="bar-text">${esc(ui.connectionNote)}</span>` : '<span class="bar-text">Open the player link you were given (/p/…).</span>');
    return;
  }
  const renderers = { draft: renderDraft, play: renderPlay, growth: renderGrowth, ended: renderEnded };
  renderers[view.phase]();
  setHtml('phase', `<span class="bar-text">${handNext.text}</span>${handNext.extra}<span class="bar-actions">${handNext.actions.join('')}</span>`);
  const dock = $('dock');
  for (const s of ['turn', 'respond', 'wait', 'end']) dock.classList.toggle(`is-${s}`, handNext.state === s);
  renderHand();
  renderMine();
  renderScore();
}

function renderDraft() {
  const view = /** @type {PlayerView} */ (ui.view);
  const me = view.me;
  if (me.picked) {
    toHand(me.kept.map((c) => cardHtml(c)), false);
    return step('wait', esc(waitingText()));
  }
  const need = me.kept.length + 1;
  const pool = [...me.kept, ...me.batch];
  if (ui.keepFor !== me.kept.length) {
    ui.keep = me.kept.slice();
    ui.keepFor = me.kept.length;
  }
  ui.keep = ui.keep.filter((c) => pool.includes(c));
  step('turn', `Keep ${need} · ${ui.keep.length}/${need} picked`);
  handAction('pick', { primary: true, disabled: ui.keep.length !== need });
  toHand(pool.map((c) => cardHtml(c, { mode: 'keep', ticked: ui.keep.includes(c) })), true);
}

function renderPlay() {
  const view = /** @type {PlayerView} */ (ui.view);
  const me = view.me;
  const pending = view.pending;
  const ready = me.hand.filter((c) => responseReady(view, c));
  const myTurn = view.toAct === view.you && !pending;
  const mustOpen = view.first === view.you && !view.opened && me.hand.some((c) => cardById(c).marked);
  if (ui.choosing && !me.hand.includes(ui.choosing)) ui.choosing = null;
  if (myTurn && ui.choosing) return renderTargeting(ui.choosing);
  toHand(me.hand.map((c) => {
    const card = cardById(c);
    const canAct = myTurn && !!card.action && (!mustOpen || !!card.marked);
    const mode = ready.includes(c) ? 'respond' : canAct ? 'act' : '';
    return cardHtml(c, { mode, influence: myTurn && !mustOpen && !!card.suit, dim: !mode });
  }), false);
  const played = pending ? `${pending.player === view.you ? '<b>You</b> play' : `<b>${esc(pending.player)}</b> plays`} <span title="${esc(describeTarget(pending.card, pending.target))}">${esc(cardById(pending.card).name)}</span>${pending.cancelled ? ' (cancelled)' : ''}` : '';
  if (ui.responding) {
    handAction('back');
    return step('respond', 'Pick a location to block');
  }
  if (pending && pending.player === view.you) {
    if (!pending.cancelled && !pending.blocked.length) handAction('withdraw', { tip: 'Take the card back (until someone answers)' });
    handAction('confirm', { primary: true, tip: 'Others may answer first; confirm to carry it out' });
    return step('turn', played);
  }
  if (pending) return step(ready.length ? 'respond' : 'wait', ready.length ? `${played} · Answer?` : played);
  if (myTurn) {
    if (!mustOpen) handAction('pass');
    return step('turn', mustOpen ? 'You go first: play your marked card' : 'Your turn');
  }
  return step(ready.length ? 'respond' : 'wait', ready.length ? 'Answer?' : esc(waitingText()));
}

/** The current view (for helpers that need it). */
const view0 = () => /** @type {PlayerView} */ (ui.view);

/** Building a card's target: the bar names the step in a few words. @param {string} cardId */
function renderTargeting(cardId) {
  const choice = /** @type {NonNullable<ReturnType<typeof currentChoice>>} */ (currentChoice());
  const card = cardById(cardId);
  const suit = spec.archetypes.find((a) => a.id === card.suit);
  const WORDS = /** @type {Record<string, string>} */ ({
    mode: 'Pick a reading', location: 'Pick a location', to: 'Pick where they go', bluff: 'Pick a spot for the bluff', path: 'Pick the next step',
    from: 'Pick where they come from', group: 'Pick a group', faction: 'Pick a faction', direction: 'Pick a direction', done: 'Ready',
  });
  const key = choice.kind === 'location' ? choice.key : choice.kind;
  const words = choice.kind === 'split' ? `Send cubes: ${choice.left} left`
    : choice.kind === 'location' && choice.key === 'path' ? `Pick the next step · ${choice.left} left` : WORDS[key] ?? '';
  const arrows = choice.kind === 'direction' ? `<span class="bar-actions">${choice.options.map((d) => `<button class="bar-btn" data-action="pick-direction" data-direction="${esc(d)}" title="${esc(d)}">${ARROWS[d] ?? d}</button>`).join('')}</span>` : '';
  const t = ui.target;
  // A step with no candidates: say so, and point at playing it for no effect.
  const none = 'options' in choice && choice.options.length === 0 && !('optional' in choice && choice.optional);
  const view = /** @type {PlayerView} */ (ui.view);
  const hasOptions = (/** @type {'location' | 'faction'} */ mode) => { const c = nextChoice(/** @type {any} */ (view), view.you, cardId, { mode }); return c.kind === 'done' || ('options' in c && c.options.length > 0); };
  const empty = card.suit && card.action ? /** @type {('location' | 'faction')[]} */ (['location', 'faction']).filter((m) => !hasOptions(m)) : [];
  step('turn', esc(choice.kind === 'mode' ? (empty.length === 2 ? 'Nothing to target: play it for no effect' : 'Pick an option on the card') : none ? 'Nothing to target: play it for no effect' : words), arrows);
  if ((choice.kind === 'location' || choice.kind === 'group') && choice.optional) handAction('skip', { label: choice.kind === 'location' && choice.key === 'bluff' ? 'No bluff' : 'Done' });
  handAction('target-none', { tip: 'Play it for no effect' });
  handAction('back');
  toHand(view.me.hand.map((c) => cardHtml(c, c === cardId ? { selected: true, influence: true, next: !t.mode && !!card.suit, reading: t.mode, empty } : { dim: true })), false);
}

function renderGrowth() {
  const view = /** @type {PlayerView} */ (ui.view);
  const g = view.growing;
  if (!g) return step('wait', 'Growth');
  const mine = g.leaders[g.next % g.leaders.length] === view.you;
  return mine ? step('turn', `Grow ${esc(fname(g.faction))}: pick a location`) : step('wait', `${esc(fname(g.faction))} grows · ${esc(waitingText())}`);
}

function renderEnded() {
  const view = /** @type {PlayerView} */ (ui.view);
  const r = view.result;
  if (!r) return step('end', 'Game over');
  const side = r.side === 'island' ? 'The island wins' : `${r.factions.map(fname).join(' and ')} win`;
  step('end', `${esc(side)} · winner: <b>${r.players.map(esc).join(', ')}</b>`);
}

// ---------------------------------------------------------------------------
// Rendering — log, chat, toast
// ---------------------------------------------------------------------------

function renderLog() {
  const view = ui.view;
  if (!view) return;
  const rounds = view.log.slice().reverse().map((entry) => `<div class="log-round">${entry.events.map((line) => `<span>${esc(line)}</span>`).join('')}</div>`);
  setHtml('log', `<h2>Log</h2>${rounds.join('') || '<p class="muted small">Nothing has resolved yet.</p>'}`);
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
  // Clicking away from a selected card (on nothing you can choose) unselects it.
  if ((ui.choosing || ui.responding) && event.target instanceof HTMLElement
    && !event.target.closest('[data-action], .card-selected, #dock, .side-stack, .overlay, .overlay-buttons')) {
    ui.choosing = null;
    ui.responding = null;
    ui.target = {};
    return render();
  }
  const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null);
  if (!target) return;
  const action = target.dataset.action;
  const view = ui.view;
  const card = target.dataset.card ?? '';
  if (action === 'pick') return sendMove({ type: 'pick', keep: ui.keep.slice() });
  if (action === 'pass') return sendMove({ type: 'pass' });
  if (action === 'confirm') return sendMove({ type: 'confirm' });
  if (action === 'withdraw') return sendMove({ type: 'withdraw' });
  if (action === 'influence') {
    ui.choosing = null;
    ui.target = {};
    return sendMove({ type: 'play', card, use: 'influence' });
  }
  if (action === 'back') {
    ui.choosing = null;
    ui.target = {};
    ui.responding = null;
    return render();
  }
  if (action === 'target-none' && ui.choosing) {
    const id = ui.choosing;
    ui.choosing = null;
    ui.target = {};
    return sendMove({ type: 'play', card: id, use: 'action', target: null });
  }
  const loc = target.dataset.location ?? '';
  if (action === 'pick-location' && view?.phase === 'growth') return sendMove({ type: 'grow', location: loc });
  if (action === 'pick-location' && ui.responding) {
    const id = ui.responding;
    ui.responding = null;
    return sendMove({ type: 'respond', card: id, location: loc });
  }
  if (ui.choosing && ['pick-location', 'pick-group', 'pick-faction', 'pick-direction', 'skip'].includes(action ?? '')) {
    const t = ui.target;
    let choice = currentChoice();
    // A suit card's reading is decided by what is clicked: one of its
    // locations (location target) or one of its faction's groups (faction).
    if (choice?.kind === 'mode') {
      const asLocation = currentChoice({ ...t, mode: 'location' });
      const asFaction = currentChoice({ ...t, mode: 'faction' });
      const fits = (/** @type {ReturnType<typeof currentChoice>} */ c) => !!c && ((action === 'pick-location' && (c.kind === 'location' || c.kind === 'split') && c.options.includes(loc))
        || (action === 'pick-group' && c.kind === 'group' && c.options.some((g) => g.location === loc && g.faction === target.dataset.faction))
        || (action === 'pick-faction' && c.kind === 'faction' && c.options.includes(target.dataset.faction ?? '')));
      t.mode = fits(asLocation) ? 'location' : fits(asFaction) ? 'faction' : t.mode;
      if (!t.mode) return;
      choice = currentChoice();
    }
    if (action === 'pick-faction') t.faction = target.dataset.faction;
    else if (action === 'pick-direction') t.direction = target.dataset.direction;
    else if (action === 'pick-group' && choice?.kind === 'group') {
      if (choice.key === 'move') t.moves = [...(t.moves ?? []), { location: loc, faction: target.dataset.faction ?? '', to: '' }];
      else Object.assign(t, { location: loc, faction: target.dataset.faction });
    } else if (action === 'pick-location' && choice?.kind === 'location') {
      if (choice.key === 'path') t.path = [...(t.path ?? []), loc];
      else if (choice.key === 'from') t.from = [...(t.from ?? []), loc];
      else if (choice.key === 'to' && t.moves?.length) t.moves[t.moves.length - 1].to = loc;
      else t[choice.key] = loc;
    } else if (action === 'pick-location' && choice?.kind === 'split') t.split = { ...(t.split ?? {}), [loc]: (t.split?.[loc] ?? 0) + 1 };
    else if (action === 'skip' && choice?.kind === 'location') {
      if (choice.key === 'bluff') t.bluff = '';
      else if (choice.key === 'path') t.path = [...(t.path ?? []), '__stop'];
      else if (choice.key === 'from') t.from = [...(t.from ?? []), '__stop'];
    } else if (action === 'skip' && choice?.kind === 'group') t.moves = [...(t.moves ?? []), { location: '__stop', faction: '', to: '__stop' }];
    // A finished target plays the card at once.
    if (currentChoice()?.kind === 'done') {
      const id = /** @type {string} */ (ui.choosing);
      ui.choosing = null;
      ui.target = {};
      return sendMove({ type: 'play', card: id, use: 'action', target: finish(t) });
    }
    return render();
  }
  if (action === 'toggle-side' || target.closest('.side-stack')) {
    const side = /** @type {HTMLElement} */ (target.closest('.side-stack'))?.id ?? null;
    ui.sideOpen = ui.sideOpen === side ? null : side;
    for (const id of ['influence', 'score']) document.getElementById(id)?.classList.toggle('is-open', ui.sideOpen === id);
    return;
  }
  if (action === 'set-mode') {
    // Picking or switching the reading (on the card) restarts the target in that reading.
    ui.choosing = target.dataset.card ?? ui.choosing;
    ui.target = { mode: /** @type {'location' | 'faction'} */ (target.dataset.mode) };
    return render();
  }
  if (action === 'expand-player') {
    // Switch the open card in place, so the accordion animates.
    ui.expanded = target.dataset.player ?? null;
    for (const el of document.querySelectorAll('#players .player')) {
      const open = /** @type {HTMLElement} */ (el).dataset.player === ui.expanded;
      el.classList.toggle('is-open', open);
      el.setAttribute('aria-expanded', String(open));
      el.querySelector('.player-detail')?.setAttribute('aria-hidden', String(!open));
    }
    return;
  }
  if (action === 'toggle-overlay') {
    const panel = document.getElementById(target.dataset.target ?? '');
    if (!panel) return;
    const opening = panel.hidden;
    for (const id of ['log-overlay', 'chat-overlay']) {
      const other = document.getElementById(id);
      if (other) other.hidden = true;
    }
    panel.hidden = !opening;
    if (opening && target.dataset.target === 'chat-overlay') {
      ui.unread = 0;
      renderUnread();
    }
    return;
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

/** Strip the "stop" markers the step-by-step builder uses. @param {import('./engine.js').Target} t */
function finish(t) {
  const out = structuredClone(t);
  if (out.path) out.path = out.path.filter((l) => l !== '__stop');
  if (out.from) out.from = out.from.filter((l) => l !== '__stop');
  if (out.moves) out.moves = out.moves.filter((m) => m.location !== '__stop');
  if (out.bluff === '') delete out.bluff;
  return out;
}

/** Clicking a card: keep it (draft), play its action, or fire its response. @param {MouseEvent} event */
function onCardClick(event) {
  const view = ui.view;
  const el = event.target instanceof HTMLElement ? event.target.closest('[data-card-mode]') : null;
  if (!view || !el || (event.target instanceof HTMLElement && event.target.closest('[data-action]'))) return;
  const id = /** @type {HTMLElement} */ (el).dataset.card ?? '';
  const mode = /** @type {HTMLElement} */ (el).dataset.cardMode;
  if (mode === 'keep') {
    ui.keep = ui.keep.includes(id) ? ui.keep.filter((c) => c !== id) : [...ui.keep, id];
    return renderPhase();
  }
  if (mode === 'respond') {
    if (cardById(id).response?.trigger === 'move-into-your-location') {
      ui.responding = id;
      return render();
    }
    return sendMove({ type: 'respond', card: id });
  }
  if (mode === 'act') {
    ui.choosing = id;
    ui.target = {};
    if (currentChoice()?.kind === 'done') {
      ui.choosing = null;
      return sendMove({ type: 'play', card: id, use: 'action', target: {} });
    }
    return render();
  }
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

/**
 * The hand's hover zone, in script (reliable where a CSS zone wasn't): the fan
 * opens when the pointer touches a card and stays open while the pointer is
 * within the cards' outline, widened 70px to the sides, down to the bottom of
 * the window and 16px above. Checked once per frame while the pointer moves.
 */
function watchHand() {
  let queued = false;
  /** @type {{ x: number, y: number }} */
  let at = { x: -1, y: -1 };
  const check = () => {
    queued = false;
    const hand = document.getElementById('hand');
    if (!hand) return;
    const cards = [...hand.querySelectorAll('.card')];
    if (!cards.length || hand.classList.contains('is-locked')) {
      hand.classList.remove('is-hovering');
      cards.forEach((x) => x.classList.remove('is-active'));
      return;
    }
    const over = document.elementFromPoint(at.x, at.y);
    const card = over ? over.closest('#hand .card') : null;
    const onCard = !!card;
    // The raised card keeps its place until another card is touched or the pointer leaves the hand.
    const activate = (/** @type {Element | null} */ c) => cards.forEach((x) => x.classList.toggle('is-active', x === c));
    if (card) activate(card);
    if (!hand.classList.contains('is-hovering')) {
      if (onCard) hand.classList.add('is-hovering');
      return;
    }
    const boxes = cards.map((c) => c.getBoundingClientRect());
    const left = Math.min(...boxes.map((b) => b.left)) - 70;
    const right = Math.max(...boxes.map((b) => b.right)) + 70;
    const top = Math.min(...boxes.map((b) => b.top)) - 16;
    const inside = at.x >= left && at.x <= right && at.y >= top;
    if (!inside && !onCard) {
      hand.classList.remove('is-hovering');
      activate(null);
    }
  };
  document.addEventListener('pointermove', (event) => {
    at = { x: event.clientX, y: event.clientY };
    if (!queued) {
      queued = true;
      requestAnimationFrame(check);
    }
  }, { passive: true });
}

function main() {
  watchHand();
  document.addEventListener('click', onClick);
  document.addEventListener('click', onCardClick);
  $('chat-form').addEventListener('submit', onChatSubmit);
  render();
  if (ui.hotseat.enabled) return void loadHotseat();
  if (ui.token) connect();
}

main();
