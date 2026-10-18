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
import { spec, factionById, locationById, cardById, waitingOn, describeTarget, nextChoice, pendingDestinations, checkTarget, previewTarget, responsesOn } from './engine.js';
import art from './assets/sprites.json' with { type: 'json' };
import { SEAT_COLOURS, tokenHtml, cubeHtml, hexHtml, faceDownHtml, effectHtml, markImg, EFFECTS } from './pieces.js';
import { cardHtml as baseCardHtml, suitIcon } from './cards.js';
import { planFlights, fly } from './motion.js';
import { targetSteps } from './guide.js';
import { tussleOn } from './fx.js';

/** @typedef {import('./engine.js').PlayerView} PlayerView */
/** @typedef {import('./engine.js').Move} Move */
/** @typedef {{ from: string, text: string, at: number }} ChatLine */

const PALETTE = SEAT_COLOURS;   // seat colours match the sway cubes
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
  /** The tutorial (/tutorial): a game held in this tab, driven by tutorial.js; moves go to `local`. */
  tutorial: location.pathname === '/tutorial',
  /** @type {((move: Move) => void) | null} where moves go instead of the server (the tutorial) */
  local: null,
  /** words for the bar and header in place of the phase's own (the tutorial's resolve steps) */
  /** @type {string | null} */
  note: null,
  /** raise the whole hand, as in the draft (the tutorial shows a card) */
  raise: false,
  /** collapse the hand out of the way (the tutorial points at the board or elsewhere) */
  tuck: false,
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
  /** a move sent, its view not back yet */
  sending: false,
  /** the server runs older rules than these files (wrangler dev stopped reloading) */
  stale: false,
  /** @type {PlayerView | null} */
  view: null,
  /** @type {string[]} */
  online: [],
  /** @type {ChatLine[]} */
  chat: [],
  /** @type {WebSocket | null} */
  socket: null,
  connectionNote: location.pathname === '/tutorial' ? 'Setting up the tutorial…' : 'Connecting…',
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
  /** the lit choice whose outcome is previewed on the board */
  /** @type {HTMLElement | null} */
  previewing: null,
  /** the target before each pick, so Back undoes one step at a time */
  /** @type {import('./engine.js').Target[]} */
  undo: [],
  /** table talk lines arrived while the overlay was closed */
  unread: 0,
  /** a response waiting for its location to be clicked (Never Invite Them In) */
  /** @type {string | null} */
  responding: null,
  /** draft: how many cards were kept when ui.keep was last reset */
  keepFor: -1,
  /** the phone map window has been centred once */
  boardCentred: false,
  /** a side stack opened by a tap: 'sway', 'score' or null */
  /** @type {string | null} */
  sideOpen: null,
  /**
   * Hints (designer, 2026-10-11): a suggested move with its reasons and the
   * rule it uses, everywhere but multiplayer games. The server answers each
   * request in order (got catches up with asked); the tutorial supplies its own.
   * mode (designer, 2026-10-11, cycled by the Hints button): off; marks (the
   * card, its way of playing and the locations marked on the table); full
   * (marks and the panel).
   * @type {{ on: boolean, mode: 'off' | 'marks' | 'full', hint: import('./hints.js').Hint | null, asked: number, got: number, source: (() => import('./hints.js').Hint | null) | null }}
   */
  hints: { on: false, mode: 'off', hint: null, asked: 0, got: 0, source: null },
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

/** A supply drawn piece by piece; above 30, one piece and the number. @param {number} n @param {() => string} piece */
const pile = (n, piece) => (n > 30 ? `${piece()}<b class="pile-count">×${n}</b>` : Array.from({ length: n }, piece).join(''));

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
  if (message.type === 'state') { queueNow.got.push(`${message.view.toAct}<${message.last?.player ?? '-'}`); queueNow.got.splice(0, queueNow.got.length - 20); }
  if (message.type === 'state') {
    ui.bots = message.bots ?? [];
    ui.sending = false; // any new view answers a sent move (a draft pick's view names no move: it's secret)
    return void receiveState(message.view, message.online, false, undefined, { last: message.last, fights: message.fights });
  }
  if (message.type === 'presence') {
    ui.online = message.online;
    return renderPlayers();
  }
  if (message.type === 'chat') return receiveChat(message.lines, message.reset === true);
  if (message.type === 'error') { if (ui.sending) { ui.sending = false; renderPhase(); } return toast(message.reason); }
  if (message.type === 'stale') { ui.stale = true; return renderHeader(); }
  if (message.type === 'hint') {
    ui.hints.got++;
    if (ui.hints.got === ui.hints.asked) { ui.hints.hint = message.hint; renderHint(); }
  }
}

/**
 * Views waiting to be shown. Each new view is shown in turn, after the pieces
 * that moved since the last one have flown there (motion.js), so every move,
 * bot turns included, is seen in order. A long queue flies faster.
 * meta: the move that made the view (another seat's turn is told by the
 * guide, at this screen's speed) and, at a round's end, its fights.
 * @typedef {{ last?: { player: string, move: import('./guide.js').SeenMove }, fights?: import('./guide.js').Fight[] }} ViewMeta
 * @type {{ view: PlayerView, online: string[], instant: boolean, speed?: number, meta?: ViewMeta, done: () => void }[]}
 */
const incoming = [];
let animating = false;
/** What the view queue is doing, for scripts/watch-play.mjs when a table stalls (dev aid, not UI). */
/** @type {{ step: string, at: number, got: string[], shown: string[] }} */
const queueNow = { step: 'idle', at: 0, got: /** @type {string[]} */ ([]), shown: /** @type {string[]} */ ([]) };
/** @param {string} step */
const mark = (step) => { queueNow.step = step; queueNow.at = Date.now(); };
/** @type {any} */ (globalThis).motwQueue = () => ({ got: queueNow.got.slice(-6), shown: queueNow.shown.slice(-6), animating, queued: incoming.length, step: queueNow.step, forMs: Date.now() - queueNow.at, toAct: ui.view?.toAct, sending: ui.sending, speed: speedNow().id });

/** @param {PlayerView} view @param {string[]} online @param {boolean} [instant] skip the flight @param {number} [speed] how fast pieces fly (default: faster as the queue grows) @param {ViewMeta} [meta] @returns {Promise<void>} once shown */
function receiveState(view, online, instant = false, speed = undefined, meta = undefined) {
  return new Promise((done) => {
    incoming.push({ view, online, instant, speed, meta, done });
    if (!animating) void showNext();
  });
}

/** Show queued views one after another. Runs synchronously when nothing moves. */
async function showNext() {
  animating = true;
  while (incoming.length) {
    const item = /** @type {(typeof incoming)[number]} */ (incoming.shift());
    const before = ui.view;
    const last = item.meta?.last;
    mark(`view ${item.view.round}:${item.view.phase} after ${last ? `${last.player} ${last.move.type}` : 'nothing'}`);
    // Another seat's move plays at this screen's speed (your own always at once, unpaused: designer, 2026-10-11).
    const other = !!before && !!last && last.player !== before.you && before.you === item.view.you;
    const s = speedNow();
    try {
      if (before && !item.instant && item.meta?.fights?.length && !s.instant && before.you === item.view.you) {
        if (other && last && s.guide) await guideTurn(before, before, last, s);
        await tellRoundEnd(before, item.view, item.meta.fights, s);
        item.done();
        continue;
      }
      if (other && last && !item.instant && s.guide) {
        mark(`guide ${last.player} ${last.move.type}`);
        await guideTurn(before, item.view, last, s);
        item.done();
        continue;
      }
    } catch (error) {
      console.error('telling a turn failed:', error);
      $('guide').hidden = true; $('round-frame').hidden = true; unlight();
    }
    const instant = item.instant || (other && s.instant);
    const flights = before && !instant ? planFlights(before, item.view, colourOf) : [];
    mark(`fly ${flights.length}`);
    if (flights.length) await fly(flights, item.view.you, { speed: item.speed ?? (other ? s.speed : 1) + incoming.length * 0.75 });
    showState(item.view, item.online);
    item.done();
  }
  animating = false;
  mark('idle');
}

/** @param {PlayerView} view @param {string[]} online */
function showState(view, online) {
  queueNow.shown.push(String(view.toAct));
  queueNow.shown.splice(0, queueNow.shown.length - 20);
  ui.view = view;
  ui.online = online;
  const phaseKey = `${view.round}:${view.phase}`;
  if (phaseKey !== ui.phaseKey) resetDrafts(phaseKey);
  render();
  if (myDecision(view)) ownScroll = false; // your move: the guide may scroll again next time
  followTheAction(view);
  autoPass(view);
  requestHint();
}

/** The view a forced pass was sent for, so it's sent once. @type {PlayerView | null} */
let passedFor = null;
/**
 * With no cards left, passing is the only move (designer, 2026-10-11: it
 * happens by itself). The tutorial makes its own. @param {PlayerView} view
 */
function autoPass(view) {
  if (ui.tutorial || ui.sending || passedFor === view || view.phase !== 'play' || view.pending || view.me.hand.length || !waitingOn(view).includes(view.you)) return;
  passedFor = view;
  sendMove({ type: 'pass' });
}

/** Clear the player's unsent choices; add fields here as real phases land. @param {string} phaseKey */
function resetDrafts(phaseKey) {
  ui.phaseKey = phaseKey;
  ui.keep = [];
  ui.choosing = null;
  ui.target = {};
  ui.undo = [];
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
  if (ui.local) return ui.local(move);
  if (!ui.socket || ui.socket.readyState !== WebSocket.OPEN) return toast('Not connected');
  ui.socket.send(JSON.stringify({ type: 'move', move }));
  ui.sending = true;
  // Your move starts moving the moment you click (designer, 2026-10-11): the table's own preview of it is shown at
  // once; the server's view, when it comes, corrects anything the preview couldn't know.
  const guess = ui.view && foresee(ui.view, move);
  if (guess) void receiveState(guess, ui.online);
  else renderPhase();
}

/**
 * Your own move, as the table can preview it (an action through the engine's
 * preview; an offering's sway), or null when there's nothing to show early.
 * @param {PlayerView} view @param {Move} move @returns {PlayerView | null}
 */
function foresee(view, move) {
  if (move.type !== 'play') return null;
  try {
    const next = structuredClone(view);
    next.me.hand = next.me.hand.filter((c) => c !== move.card);
    next.toAct = null;
    if (move.use === 'sway') {
      const f = view.factions.find((x) => factionById(x).archetype === cardById(move.card).suit);
      if (!f) return null;
      next.players[view.you].standing[f] = (next.players[view.you].standing[f] ?? 0) + (view.printed?.[move.card] ?? cardById(move.card).sway ?? 0);
      return next;
    }
    if (!move.target) return null;
    const { board, players } = previewTarget(view, view.you, move.card, move.target);
    next.board = /** @type {PlayerView['board']} */ (/** @type {unknown} */ (board));
    for (const pid of view.seating) if (players[pid]) { next.players[pid].standing = { ...players[pid].standing }; next.players[pid].supply = players[pid].supply; }
    return next;
  } catch { return null; }
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

/** @param {string} f */
const fname = (f) => factionById(f).name;

function renderHeader() {
  const view = ui.view;
  const status = view ? `${ui.tutorial ? 'Tutorial · ' : ''}Round ${view.round} of ${view.rounds} — ${ui.note ?? PHASE_LABELS[view.phase]}` : ui.connectionNote;
  const you = view ? `<span class="row"><span class="swatch" style="height:12px;background:${colourOf(view.you)}"></span> ${esc(view.you)}</span>` : '';
  setHtml('header-main', `
    <h1>MONSTER OF THE WEEK</h1>
    <span class="phase-label">${esc(status)}</span>
    ${you}
    <span class="muted small">${esc(ui.connectionNote)}</span>
    ${ui.stale ? '<span class="tag stale-tag" title="The worker hasn\'t reloaded since the game files changed; the table and the rules may not match.">Server running old code: restart npm run dev</span>' : ''}`);
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
      row('Supply', `<span class="supply-row tokens" title="${p.supply} in supply">${pile(p.supply, () => cubeHtml(colourOf(id), 8))}</span>`),
      row('Hand', miniCards(p.handSize) || '<span class="muted">empty</span>'),
      id === view.you ? row('Trophies', `<span class="trophies" title="Secret: only you see these (IN2)">${trophies || '<span class="muted">none yet</span>'}</span>`) : '',
    ].join('');
    return `
      <div class="player ${id === view.you ? 'player-you' : ''} ${isOpen ? 'is-open' : ''}" data-action="expand-player" data-player="${esc(id)}" aria-expanded="${isOpen}" style="--seat:${colourOf(id)}">
        <span class="player-row player-head"><span class="player-name"><span class="presence ${ui.online.includes(id) ? 'presence-on' : ''}"></span>${esc(id)}${id === view.you ? ' <span class="muted small">(you)</span>' : ''}${ui.bots.includes(id) ? ' <span class="tag">bot</span>' : ''}</span><span class="player-status">${esc(playerStatus(id))}${miniCards(p.handSize)}</span></span>
        <span class="player-supply-mini" title="${p.supply} in supply">${pile(p.supply, () => cubeHtml(colourOf(id), 7))}</span>
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
    out.spots = pendingDestinations(/** @type {any} */ (view), view.pending).filter((l) => (view.board[l].sway[view.you] ?? 0) > 0 && !view.pending?.blocked.includes(l));
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
 * players' sway cubes. A candidate group's row is lit and clickable, and
 * so is every group of a candidate faction.
 * @param {string} loc @param {ReturnType<typeof picks>} lit @param {PlayerView['board']} [board]
 */
function piecesAt(loc, lit, board = /** @type {PlayerView} */ (ui.view).board) {
  const view = /** @type {PlayerView} */ (ui.view);
  const place = board[loc];
  const rows = Object.entries(place.tokens).filter(([, n]) => n > 0).map(([f, n]) => {
    // A group step lights the group; a faction step lights every group of that faction, and picking one picks the faction.
    const group = lit.groups.some((g) => g.location === loc && g.faction === f);
    const faction = !group && lit.factions.includes(f);
    const action = group ? ` data-action="pick-group" data-location="${esc(loc)}" data-faction="${esc(f)}"` : faction ? ` data-action="pick-faction" data-faction="${esc(f)}"` : '';
    const tokens = Array.from({ length: n }, () => tokenHtml(f, 1, group || faction ? 'candidate' : '')).join('');
    return `<span class="token-stack piece-row"${action}${group ? '' : ` data-location="${esc(loc)}"`}${group || faction ? '' : ` data-faction="${esc(f)}"`} title="${n} ${esc(fname(f))}">${tokens}</span>`;
  });
  const cubes = Object.entries(place.sway).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    .flatMap(([pid, n]) => Array.from({ length: n }, () => cubeHtml(colourOf(pid), 8))).join('');
  const t = place.token;
  const token = t ? faceDownHtml(t, colourOf(t.owner), t.real === undefined ? `a face-down ${t.kind ? cardById(t.kind).name : ''} token: real or a bluff` : `your ${t.kind ? cardById(t.kind).name : ''} token: ${t.real ? 'the real one' : 'the bluff'}`) : '';
  // Effects a card left here for the round, each as a token with its icon.
  const effects = /** @type {(keyof typeof EFFECTS)[]} */ (Object.keys(EFFECTS)).filter((k) => { const v = /** @type {Record<string, unknown>} */ (place)[k]; return Array.isArray(v) ? v.length > 0 : !!v; }).map(effectHtml).join('');
  // Face-down and effect tokens sit in a column at the location's side, apart from the groups and sway (designer, 2026-10-11).
  return `${rows.join('')}<span class="cube-row piece-row">${cubes}</span>${token || effects ? `<span class="side-marks">${token}${effects}</span>` : ''}`;
}

/** The faction summaries: one row per faction in play. @param {ReturnType<typeof picks>} lit */
function factionTable(lit) {
  const view = shownView();
  const rows = view.factions.map((f) => {
    const faction = factionById(f);
    const arch = spec.archetypes.find((a) => a.id === faction.archetype);
    const best = Math.max(0, ...view.seating.map((pid) => view.players[pid].standing[f] ?? 0));
    const sway = view.seating.filter((pid) => (view.players[pid].standing[f] ?? 0) > 0)
      .sort((a, b) => view.players[b].standing[f] - view.players[a].standing[f]).map((pid) => {
      const n = view.players[pid].standing[f];
      return `<span class="standing-group${n === best ? ' is-leading' : ''}" title="${esc(pid)}: ${n}">${Array.from({ length: n }, () => cubeHtml(colourOf(pid), 8)).join('')}</span>`;
    }).join('');
    const on = lit.factions.includes(f);
    return `<div class="faction-row${on ? ' is-candidate' : ''}" data-faction="${esc(f)}"${on ? ' data-action="pick-faction"' : ''}>
      <span class="faction-id cell-id">${tokenHtml(f, 2, on ? 'candidate' : '')}<span><b>${esc(faction.name)}</b><span class="small muted suit-line">${suitIcon(arch?.id)} ${esc(arch?.name ?? '')}</span></span></span>
      <span class="faction-cell cell-supply" data-label="Supply"><span class="supply-row" title="${view.supply[f]} in supply">${pile(view.supply[f], () => tokenHtml(f, 1))}</span></span>
      <span class="faction-cell cell-sway" data-label="Sway"><span class="standing-row">${sway || '<span class="small muted">—</span>'}</span></span>
    </div>`;
  });
  return `<div class="faction-table">
    <div class="faction-row faction-head small muted"><span>Faction</span><span>Supply</span><span>Sway</span></div>
    ${rows.join('')}</div>`;
}

/**
 * Total presence as a gauge at the top of the island: the bar is the
 * invaders' tokens on the board, the mark the threshold (TH1). Red past the
 * mark: as things stand, the invaders would win.
 * @param {number} total @param {number} threshold @param {number} rounds
 */
function presenceGauge(total, threshold, rounds) {
  const top = Math.max(total, threshold * 2, 1);
  const over = total > threshold;
  return `<div class="gauge${over ? ' is-over' : ''}" style="--now:${(100 * total) / top}%;--mark:${(100 * threshold) / top}%" title="${total} monster tokens on the island: the invaders win if more than ${threshold} are left at the end of round ${rounds}.">
      <span class="gauge-label">Monsters on the island</span>
      <span class="gauge-track"><span class="gauge-fill"></span><span class="gauge-mark"><b>${threshold}</b></span></span>
      <span class="gauge-value"><b>${total}</b></span>
    </div>
    <p class="small muted gauge-note">After round ${rounds}: more than ${threshold} left, invader sway decides the winner; ${threshold} or fewer, complete trophy sets decide it.</p>`;
}

function renderBoard() {
  const view = ui.view;
  if (!view) return;
  const board = /** @type {{ width: number, height: number, src: string, tiles: { loc: string, region: string, x: number, y: number }[] } | undefined} */ (art.board);
  const S = 2;
  const lit = picks();
  const chosen = new Set([ui.target.location, ui.target.to, ui.target.bluff, ...(ui.target.path ?? []), ...(ui.target.from ?? []), ...Object.keys(ui.target.split ?? {})].filter(Boolean));
  const shown = shownView().board;
  const tiles = (board?.tiles ?? []).map((t) => {
    const place = shown[t.loc];
    const on = lit.spots.includes(t.loc);
    const state = on ? 'candidate' : ui.choosing && chosen.has(t.loc) ? 'hovered' : '';
    return `<div class="board-tile${place.scorched ? ' is-scorched' : ''}" data-tile="${esc(t.loc)}"${on ? ` data-action="pick-location" data-location="${esc(t.loc)}"` : ''} title="${esc(locationById(t.loc).name)} · ${esc(t.region)}" style="position:absolute;left:${t.x * S}px;top:${t.y * S}px">${hexHtml(t.loc, S, place.scorched ? `<span class="rubble">${markImg('rubble', S)}</span>` : piecesAt(t.loc, lit, shown), /** @type {import('./pieces.js').TargetState} */ (state))}<div class="hex-preview" aria-hidden="true"></div></div>`;
  });
  const total = Object.values(view.board).reduce((n, pl) => n + Object.values(pl.tokens).reduce((a, b) => a + b, 0), 0);
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
    ${factionTable(lit)}`);
  setHtml('board', `
    <h2>The island</h2>
    ${presenceGauge(total, Number(view.options.threshold), view.rounds)}
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
  // Responses are out of the first draft (variant responses, off): no card answers anything then.
  if (!r || view.phase !== 'play' || !responsesOn(view)) return false;
  const pend = view.pending;
  const others = (/** @type {string} */ type) => view.events.some((e) => e.type === type && e.player !== view.you);
  switch (r.trigger) {
    case 'card-played': return !!pend && pend.player !== view.you && !pend.cancelled;
    case 'move-into-your-location': return !!pend && pend.player !== view.you && !pend.cancelled
      && pendingDestinations(/** @type {any} */ (view), pend).some((l) => (view.board[l].sway[view.you] ?? 0) > 0 && !pend.blocked.includes(l));
    case 'token-placed': return others('token-placed');
    case 'sway-spent': return others('sway-spent');
    case 'sway-placed': return others('sway-placed');
    case 'pass': return others('pass');
    default: return false;
  }
}

/** A card, as the table shows it (cards.js), with the current view. @param {string} id @param {import('./cards.js').CardOptions} [o] */
const cardHtml = (id, o = {}) => baseCardHtml(id, { ...o, view: ui.view });

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
  el.classList.toggle('is-open', (open || ui.raise) && !ui.tuck);
  el.classList.toggle('is-tucked', ui.tuck && !ui.raise);
  el.classList.toggle('is-locked', !!ui.choosing || !!ui.responding);
  el.style.setProperty('--n', String(n));
  markHint();
}

/** A small chip: an icon and a number, with a tooltip. @param {string} icon @param {number | string} value @param {string} tip */
const chip = (icon, value, tip) => `<span class="chip" title="${esc(tip)}">${icon}<b>${value}</b></span>`;

/** Your resources, left of the bar: supply, bluffs, and standing with each faction. */
function renderMine() {
  const view = shownView();
  const me = view.players[view.you];
  const standing = view.factions.filter((f) => (me.standing[f] ?? 0) > 0).sort((a, b) => me.standing[b] - me.standing[a])
    .map((f) => `<span class="side-row">${tokenHtml(f, 1)}<b>${me.standing[f]}</b><span class="side-name">${esc(fname(f))}</span></span>`).join('');
  setHtml('mine', `${chip(cubeHtml(colourOf(view.you), 9), me.supply, `Supply: ${me.supply} sway`)}${chip('<span class="bluff"></span>', me.bluffs, `Bluff tokens: ${me.bluffs}`)}`);
  setHtml('sway', `<span class="side-head" data-action="toggle-side" data-side="sway">Sway</span>${standing || '<span class="side-row is-zero"><span class="muted">—</span></span>'}`);
  $('sway').classList.toggle('is-open', ui.sideOpen === 'sway');
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
  if (ui.note) handNext = { ...handNext, actions: [], state: 'wait', text: esc(ui.note) };
  // A move on its way to the server: said at once, so a click never looks dead (designer, 2026-10-11).
  if (ui.sending) handNext = { ...handNext, actions: [], text: 'Sending…' };
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
  // Only the earliest marked card opens (FP2; the engine checks it), so only it is offered.
  const opener = mustOpen ? me.hand.filter((c) => cardById(c).marked).sort((a, b) => String(cardById(a).marked).localeCompare(String(cardById(b).marked)))[0] : null;
  if (ui.choosing && !me.hand.includes(ui.choosing)) ui.choosing = null;
  if (myTurn && ui.choosing) return renderTargeting(ui.choosing);
  toHand(me.hand.map((c) => {
    const card = cardById(c);
    const canAct = myTurn && !!card.action && (!mustOpen || c === opener);
    const mode = ready.includes(c) ? 'respond' : canAct ? 'act' : '';
    return cardHtml(c, { mode, sway: myTurn && !mustOpen && !!card.suit, dim: !mode });
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
    return step('turn', mustOpen ? `You go first: open with ${opener ? cardById(opener).name : 'your marked card'}` : 'Your turn');
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
    mode: 'Pick a reading', location: 'Pick a location', to: 'Pick where they go', bluff: 'Pick a spot for the bluff', path: 'Pick the next step', lure: 'Tied: pick which group comes',
    from: 'Pick where they come from', group: 'Pick a group', faction: 'Pick a faction', direction: 'Pick a direction', done: 'Ready',
  });
  const key = choice.kind === 'location' || (choice.kind === 'group' && choice.key === 'lure') ? choice.key : choice.kind;
  const gateWords = /** @type {Record<string, string>} */ ({ location: 'Pick one end of the Gate', to: 'Pick the other end', losses: 'Pick the end that takes the winner\'s losses' });
  const words = card.action === 'gate' && choice.kind === 'location' && gateWords[choice.key] ? gateWords[choice.key]
    : card.action === 'burst' && choice.kind === 'location' && choice.key === 'from' ? 'Pick where a token bursts to'
    : card.action === 'rejoin' && choice.kind === 'location' && choice.key === 'from' ? 'Pick a group to get one more token'
    : card.action === 'swarm' && choice.kind === 'location' && choice.key === 'path' ? `Pick a group next door to link in · up to ${choice.left} more`
    : card.action === 'control' && choice.kind === 'location' && choice.key === 'from' ? `Spend 1 of your sway there to cut down one more · up to ${choice.left} more`
    : card.action === 'control' && choice.kind === 'faction' ? 'Pick the faction the machines turn on'
    : card.action === 'raise' && choice.kind === 'location' && choice.key === 'from' ? `Raise one more of the dead · up to ${choice.left} more`
    : card.action === 'plough' && choice.kind === 'faction' && choice.key === 'payer' ? 'Pick which side pays at the fight'
    : card.action === 'plough' && choice.kind === 'location' && choice.key === 'from' ? `Pick an exit for the next token · ${choice.left} left`
    : choice.kind === 'split' ? `Send tokens: ${choice.left} left`
    : choice.kind === 'location' && choice.key === 'from' && card.action === 'move-sway' ? `Pick your sway to move · ${3 - (ui.target.from ?? []).filter((l) => l !== '__stop').length} left`
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
  handAction('back', { tip: ui.undo.length ? 'Undo the last pick' : 'Put the card down' });
  toHand(view.me.hand.map((c) => cardHtml(c, c === cardId ? { selected: true, sway: true, next: !t.mode && !!card.suit, reading: t.mode, empty } : { dim: true })), false);
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
  $('hint-button').hidden = !hintsAvailable();
  renderSpeed();
  markHint();
}

// ---------------------------------------------------------------------------
// Other seats' turns and the round's end, told on the table
// ---------------------------------------------------------------------------

/**
 * How other seats' turns play on this screen (designer, 2026-10-11: a button
 * cycles them; each player's own setting, never applied to their own moves).
 * guide: the turn told step by step (the card, each step of its target, the
 * pieces moving, the result), pausing this long between steps (ms).
 */
const SPEEDS = /** @type {const} */ ([
  { id: 'instant', label: 'Instant', speed: 1, instant: true, guide: 0 },
  { id: 'very-fast', label: 'Very fast', speed: 3, instant: false, guide: 0 },
  { id: 'normal', label: 'Normal', speed: 1, instant: false, guide: 0 },
  { id: 'guide', label: 'Normal + guide', speed: 1, instant: false, guide: 1100 },
  { id: 'slow', label: 'Slow + guide', speed: 0.8, instant: false, guide: 2000 },
  { id: 'very-slow', label: 'Very slow + guide', speed: 0.6, instant: false, guide: 3400 },
]);
const SPEED_KEY = 'motw-bot-speed';
let speedAt = 3;
try { const i = SPEEDS.findIndex((x) => x.id === localStorage.getItem(SPEED_KEY)); if (i >= 0) speedAt = i; } catch { /* a convenience only */ }
const speedNow = () => SPEEDS[speedAt];
function renderSpeed() {
  const b = document.getElementById('speed-button');
  if (!b) return;
  b.textContent = `Turns: ${speedNow().label}`;
  b.title = 'How other seats\' turns play: Instant → Very fast → Normal → Normal + guide → Slow + guide → Very slow + guide';
}
function cycleSpeed() {
  speedAt = (speedAt + 1) % SPEEDS.length;
  try { localStorage.setItem(SPEED_KEY, speedNow().id); } catch { /* a convenience only */ }
  renderSpeed();
}

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const lname = (/** @type {string} */ l) => locationById(l).name;
/** A seat's name in a sentence. @param {string} pid */
const seatName = (pid) => (pid === ui.view?.you ? 'You' : pid);

/** Light a table element for the guide or the round frame (cleared by unlight). @param {Element | null | undefined} el */
function light(el) { if (el) el.classList.add('is-guided'); }
function unlight() { for (const x of document.querySelectorAll('.is-guided')) x.classList.remove('is-guided'); }
const tileOf = (/** @type {string} */ l) => document.querySelector(`#board [data-tile="${CSS.escape(l)}"]`);
const hexOf = (/** @type {string} */ l) => tileOf(l)?.querySelector('.hex');

/**
 * You took the scroll yourself while other seats' turns were being told
 * (designer, 2026-10-11): the guide leaves the page where you put it until
 * your next move. Real input only (wheel, touch, scroll keys); the guide's own
 * scrolling doesn't count.
 */
let ownScroll = false;
const tookScroll = () => { if (animating) ownScroll = true; };
globalThis.addEventListener?.('wheel', tookScroll, { passive: true });
globalThis.addEventListener?.('touchmove', tookScroll, { passive: true });
globalThis.addEventListener?.('keydown', (/** @type {KeyboardEvent} */ e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) tookScroll(); });

/** Bring an element into view if it's off screen (desktop sections never scroll on their own). @param {Element | null | undefined} el */
function reveal(el) {
  if (!el || ownScroll) return Promise.resolve();
  const r = el.getBoundingClientRect();
  if (r.top >= 60 && r.bottom <= window.innerHeight - 120) return Promise.resolve();
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return wait(400);
}

/**
 * Put a floating panel beside some table elements, covering as little of them
 * and of the hand as it can (as the tutorial's tooltip and the hint panel do).
 * @param {HTMLElement} panel @param {Element[]} anchors
 */
function placeNear(panel, anchors) {
  if (window.matchMedia('(max-width: 600px), (hover: none) and (pointer: coarse)').matches) { panel.style.left = panel.style.top = ''; return; }
  const vw = window.innerWidth, vh = window.innerHeight, gap = 12, m = 12;
  const rs = anchors.map((x) => x.getBoundingClientRect()).filter((r) => r.width && r.bottom > 0 && r.top < vh);
  const avoid = [...rs, ...[...document.querySelectorAll('#hand .card, #dock')].map((x) => x.getBoundingClientRect())];
  const pw = panel.offsetWidth, ph = panel.offsetHeight;
  /** @type {number[][]} */
  const spots = [];
  if (rs.length) {
    const b = { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
    const cx = (b.left + b.right) / 2 - pw / 2, cy = (b.top + b.bottom) / 2 - ph / 2;
    spots.push([b.right + gap, cy], [b.left - gap - pw, cy], [cx, b.top - gap - ph], [cx, b.bottom + gap]);
  }
  spots.push([m, 56], [vw - pw - m, 56]);
  const fit = spots.map(([x, y]) => [Math.max(m, Math.min(vw - pw - m, x)), Math.max(56, Math.min(vh - ph - m, y))]);
  const covered = (/** @type {number} */ x, /** @type {number} */ y) => avoid.reduce((n, r) => n + Math.max(0, Math.min(x + pw, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + ph, r.bottom) - Math.max(y, r.top)), 0);
  let best = fit[0], least = Infinity;
  for (const [x, y] of fit) { const c = covered(x, y); if (c < least - 1) { least = c; best = [x, y]; } }
  panel.style.left = `${Math.round(best[0])}px`;
  panel.style.top = `${Math.round(best[1])}px`;
}

/** What changed on the table between two views, as short lines. @param {PlayerView} a @param {PlayerView} b */
function changeLines(a, b) {
  const out = [];
  for (const loc of Object.keys(b.board)) {
    const pa = a.board[loc], pb = b.board[loc];
    const parts = b.factions.map((f) => [f, (pb.tokens[f] ?? 0) - (pa.tokens[f] ?? 0)]).filter(([, n]) => n).map(([f, n]) => `${Number(n) > 0 ? '+' : '−'}${Math.abs(Number(n))} ${fname(String(f))}`);
    for (const pid of b.seating) { const n = (pb.sway[pid] ?? 0) - (pa.sway[pid] ?? 0); if (n) parts.push(`${n > 0 ? '+' : '−'}${Math.abs(n)} sway (${seatName(pid)})`); }
    if (!pa.token && pb.token) parts.push('a face-down token');
    if (parts.length) out.push(`${lname(loc)}: ${parts.join(', ')}`);
  }
  for (const pid of b.seating) for (const f of b.factions) {
    const n = (b.players[pid].standing[f] ?? 0) - (a.players[pid].standing[f] ?? 0);
    if (n) out.push(`${seatName(pid)}: ${n > 0 ? '+' : '−'}${Math.abs(n)} sway with the ${fname(f)}`);
  }
  return out;
}

/**
 * Tell another seat's turn on the table (the guide): who plays which card
 * and how (its text too), then each step of its target lit in turn, then the
 * pieces moving, then what changed. No buttons: it pauses between steps.
 * @param {PlayerView} before @param {PlayerView} after @param {{ player: string, move: import('./guide.js').SeenMove }} last @param {(typeof SPEEDS)[number]} s
 */
async function guideTurn(before, after, last, s) {
  const panel = $('guide');
  const pid = last.player, m = last.move;
  const seat = document.querySelector(`#players .player[data-player="${CSS.escape(pid)}"]`);
  /** @type {string[]} */
  const lines = [];
  let head = '';
  /** @type {Element[]} */
  let anchors = seat ? [seat] : [];
  const draw = () => { panel.innerHTML = `${head}${lines.length ? `<ol class="guide-steps">${lines.map((l) => `<li>${l}</li>`).join('')}</ol>` : ''}`; placeNear(panel, anchors); };
  const who = `<span class="swatch" style="background:${colourOf(pid)}"></span><b>${esc(seatName(pid))}</b>`;
  if (m.type === 'pass') {
    head = `<p class="guide-head">${who} ${pid === before.you ? 'pass' : 'passes'}</p>`;
    panel.hidden = false; light(seat); draw();
    await wait(s.guide * 0.6);
    panel.hidden = true; unlight();
    showState(after, ui.online); // the turn moves on: every way out of the guide shows the new view
    return;
  }
  if (m.type === 'play') {
    const c = cardById(m.card);
    const how = m.use === 'sway' ? `+${before.printed?.[m.card] ?? c.sway} sway` : m.target?.mode === 'faction' ? 'FAC' : m.target?.mode === 'location' ? 'LOC' : '';
    head = `<p class="guide-head">${who} ${m.use === 'sway' ? 'spends' : 'plays'} <b class="guide-card card-suit-${c.suit ?? 'none'}">${c.suit ? suitIcon(c.suit) : ''} ${esc(c.name)}</b>${how ? ` <span class="tag">${esc(how)}</span>` : ''}</p>${m.use === 'action' ? `<p class="guide-text small">${esc(c.text)}</p>` : ''}`;
  } else if (m.type === 'hidden') head = `<p class="guide-head">${who} plays <b class="guide-card">${esc(cardById(m.card).name)}</b> face down</p><p class="guide-text small">${esc(cardById(m.card).text)}</p><p class="guide-text small">Its tokens look the same: one is real, one a bluff, and only ${esc(seatName(pid))} knows which. Each carries 1 sway as a bid; both flip when the location fights.</p>`;
  else if (m.type === 'grow') head = `<p class="guide-head">${who} chooses where a faction grows</p>`;
  else if (m.type === 'respond') head = `<p class="guide-head">${who} answers with <b>${esc(cardById(m.card).name)}</b></p>`;
  else head = `<p class="guide-head">${who}</p>`;
  panel.hidden = false; light(seat); draw();
  await wait(s.guide);
  // Each step of the target, lit in turn.
  /** @type {import('./guide.js').Step[]} */
  let steps = [];
  if (m.type === 'play' && m.use === 'action' && m.target) { try { steps = targetSteps(before, pid, m.card, m.target); } catch { steps = []; } }
  if (m.type === 'play' && m.use === 'sway') {
    const f = before.factions.find((x) => factionById(x).archetype === cardById(m.card).suit);
    if (f) steps = [{ kind: 'faction', faction: f, label: `with the ${fname(f)}` }];
  }
  if (m.type === 'hidden') steps = m.locations.map((l) => ({ kind: 'location', location: l, label: `at ${lname(l)}` }));
  if (m.type === 'grow') steps = [{ kind: 'location', location: m.location, label: `at ${lname(m.location)}` }];
  for (const step of steps) {
    const el = step.kind === 'location' ? tileOf(step.location)
      : step.kind === 'group' ? document.querySelector(`#board .token-stack[data-location="${CSS.escape(step.location)}"][data-faction="${CSS.escape(step.faction)}"]`) ?? tileOf(step.location)
      : step.kind === 'faction' ? document.querySelector(`#factions .faction-row[data-faction="${CSS.escape(step.faction)}"]`) : null;
    await reveal(el);
    if (step.kind === 'location') light(hexOf(step.location)); else light(el);
    if (el) anchors = [el];
    lines.push(esc(step.label));
    draw();
    await wait(s.guide * 0.7);
  }
  // The pieces move, then what changed.
  const flights = planFlights(before, after, colourOf);
  if (flights.length) await fly(flights, after.you, { speed: s.speed });
  showState(after, ui.online);
  const changed = changeLines(before, after);
  if (changed.length) { lines.push(`<span class="guide-result">${changed.map(esc).join('<br>')}</span>`); draw(); }
  await wait(s.guide);
  panel.hidden = true;
  unlight();
}

/**
 * The round's end, told (designer, 2026-10-11): a frame listing every fight
 * with its numbers; each fight then plays on the board one at a time (the
 * tussle, the dead flying to trophies and supplies) and its row in the frame
 * fills in with the result; then growth. Piles taken are public (IN2: the
 * running totals stay secret).
 * @param {PlayerView} before @param {PlayerView} final @param {import('./guide.js').Fight[]} fights @param {(typeof SPEEDS)[number]} s
 */
async function tellRoundEnd(before, final, fights, s) {
  const frame = $('round-frame');
  const pause = s.guide || (s.speed > 1 ? 150 : 600);
  const icon = (/** @type {string} */ f, /** @type {number} */ n) => `${tokenHtml(f, 1)}<b>${n}</b>`;
  const bids = (/** @type {Record<string, number>} */ sway) => Object.entries(sway).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).map(([pid, n]) => `<span class="round-bid"><span class="swatch" style="background:${colourOf(pid)}"></span>${esc(seatName(pid))} ${n}</span>`).join('') || '<span class="muted">no sway</span>';
  const result = (/** @type {import('./guide.js').Fight} */ x) => {
    const winner = x.sides.find((t) => t.lost < t.n);
    const level = x.sides.length === 2 && x.sides[0].n === x.sides[1].n && !x.flipped;
    const fightLine = !winner ? 'Level: both wiped out' : `${fname(winner.f)} win${level ? ' on their own ground' : ''}, losing ${winner.lost}`;
    // Each player's piles together (IN2: who takes which pile is seen; totals stay secret).
    const by = new Map();
    for (const p of x.piles) by.set(p.pid, [...(by.get(p.pid) ?? []), `${p.n} ${p.n === 1 ? fname(p.f).replace(/ves$/, 'f').replace(/s$/, '') : fname(p.f)}`]);
    const piles = [...by].map(([pid, ps]) => `${esc(seatName(pid))} ${pid === final.you ? 'take' : 'takes'} ${esc(ps.join(' + '))}`).join(' · ');
    return `${x.flipped ? `<span class="small muted">${x.flipped === final.you ? 'Your' : `${esc(x.flipped)}'s`} face-down token flipped first.</span> ` : ''}<b>${esc(fightLine)}</b>${x.scorched ? ' · the location is scorched' : ''} · ${piles || 'nobody collects'}`;
  };
  frame.innerHTML = `<h2>Round ${before.round} · the fights</h2>
    <ol class="round-fights">${fights.map((x, i) => `<li class="round-fight" data-i="${i}"><span class="round-where">${esc(lname(x.loc))}</span>
      <span class="round-sides">${x.sides.map((t) => icon(t.f, t.n)).join('<span class="muted">vs</span>')}${x.flipped ? faceDownHtml({ kind: before.board[x.loc].token?.kind, real: before.board[x.loc].token?.real }, colourOf(x.flipped), 'a face-down token: it flips first') : ''}</span>
      <span class="round-bids">${bids(x.sway)}</span>
      <span class="round-result muted">…</span></li>`).join('')}</ol>
    <p class="round-growth small muted" hidden></p>`;
  frame.hidden = false;
  placeNear(frame, fights.map((x) => hexOf(x.loc)).filter((x) => !!x));
  await wait(pause);
  let cur = before;
  for (const [i, x] of fights.entries()) {
    const row = frame.querySelector(`.round-fight[data-i="${i}"]`);
    row?.classList.add('is-active');
    const tile = tileOf(x.loc), hex = hexOf(x.loc);
    await reveal(tile);
    light(hex);
    if (hex) placeNear(frame, [hex]); // step aside from the fight being told
    if (s.speed <= 1 && tile && hex) await tussleOn(tile, hex, s.guide ? 1100 : 700);
    // The pieces after this fight: the location, the supplies, everyone's sway; your own piles to your trophies.
    const next = structuredClone(cur);
    next.board[x.loc] = { ...next.board[x.loc], ...x.place };
    next.supply = { ...x.supply };
    for (const [pid, p] of Object.entries(x.players)) if (next.players[pid]) { next.players[pid].standing = { ...p.standing }; next.players[pid].supply = p.supply; }
    for (const p of x.piles) if (p.pid === next.you) next.me.trophies[p.f] = (next.me.trophies[p.f] ?? 0) + p.n;
    const flights = planFlights(cur, next, colourOf);
    if (flights.length) await fly(flights, next.you, { speed: s.speed });
    ui.view = next;
    render();
    const res = row?.querySelector('.round-result');
    if (res) { res.innerHTML = result(x); res.classList.remove('muted'); }
    row?.classList.remove('is-active');
    row?.classList.add('is-done');
    await wait(pause);
    unlight();
    cur = next;
  }
  // Growth (and the next round's deal), then the frame steps aside.
  const grew = Object.keys(final.board).filter((l) => final.factions.some((f) => (final.board[l].tokens[f] ?? 0) > (cur.board[l].tokens[f] ?? 0)));
  const g = frame.querySelector('.round-growth');
  if (g instanceof HTMLElement && grew.length) { g.hidden = false; g.textContent = `Growth: ${grew.map(lname).join(', ')}`; for (const l of grew) light(hexOf(l)); }
  const flights = planFlights(cur, final, colourOf);
  if (flights.length) await fly(flights, final.you, { speed: s.speed });
  showState(final, ui.online);
  await wait(pause * 1.5);
  unlight();
  frame.hidden = true;
}

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

/** Hints are for the tutorial and games with one human seat (designer: not multiplayer). */
function hintsAvailable() {
  const view = ui.view;
  if (!view) return false;
  if (ui.tutorial) return true;
  return view.seating.filter((id) => !ui.bots.includes(id)).length === 1; // hotseat too, when it's one human against bots
}

/** Whether this seat has a decision to make now. @param {PlayerView} view */
function myDecision(view) {
  if (view.phase === 'ended') return false;
  if (view.phase === 'draft') return !view.players[view.you].picked;
  return waitingOn(view).includes(view.you);
}

/** Ask for a hint for the view now showing (when hints are on and it's this seat's move). */
function requestHint() {
  const view = ui.view;
  if (!ui.hints.on || !view || !hintsAvailable() || ui.sending) return;
  ui.hints.hint = null;
  if (!myDecision(view)) return renderHint();
  ui.hints.asked++;
  if (ui.hints.source) {
    ui.hints.got = ui.hints.asked;
    ui.hints.hint = ui.hints.source();
    return renderHint();
  }
  if (!ui.socket || ui.socket.readyState !== WebSocket.OPEN) return;
  renderHint();
  ui.socket.send(JSON.stringify({ type: 'hint' }));
}

const HINT_MODES = /** @type {const} */ (['off', 'marks', 'full']);
const HINT_LABELS = { off: 'Hints: off', marks: 'Hints: marks', full: 'Hints: full' };
/** Set the hint mode (the Hints button cycles it; the tutorial starts full). @param {'off' | 'marks' | 'full'} mode */
function setHints(mode) {
  ui.hints.mode = mode;
  const on = mode !== 'off';
  try { localStorage.setItem('motw-hints', mode); } catch { /* a convenience only */ }
  ui.hints.on = on;
  if (on) requestHint();
  else ui.hints.hint = null;
  renderHint();
}

/**
 * The hint panel (designer, 2026-10-11): concise (the move in a few words and
 * its main reason), opening on hover or tap to the full move, every reason,
 * the plan, the rule it uses and other options. Shown only while there's a
 * hint (or one is coming); placed beside what it suggests (placeHint).
 */
function renderHint() {
  const h = ui.hints.hint;
  const view = ui.view;
  const waiting = !!view && myDecision(view) && ui.hints.got < ui.hints.asked;
  const panel = $('hint-overlay');
  panel.hidden = ui.hints.mode !== 'full' || (!h && !waiting);
  const button = $('hint-button');
  button.classList.toggle('is-on', ui.hints.on);
  button.textContent = HINT_LABELS[ui.hints.mode];
  button.title = 'Hints: off → marks on the table → marks and the panel';
  if (panel.hidden) return markHint();
  panel.classList.remove('is-open');
  $('hint').innerHTML = !h
    ? '<p class="muted small">Thinking…</p>'
    : `<h3 class="hint-title">${esc(h.short ?? h.title)}</h3>
      <p class="hint-gist">${esc(h.why[0] ?? '')}</p>
      <div class="hint-more"><div class="hint-more-inner">
        ${h.short && h.title !== h.short ? `<p class="hint-full">${esc(h.title)}</p>` : ''}
        ${h.why.length > 1 ? `<ul class="hint-why">${h.why.slice(1).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <p class="hint-plan"><span class="field-label">Plan</span> ${esc(h.plan)}</p>
        <p class="hint-rule">↩ ${esc(h.rule)}</p>
        ${h.others.length ? `<div class="hint-others"><span class="field-label">Other options</span>${h.others.map((o) => `<p><b>${esc(o.title)}</b><br><span class="small muted">${esc(o.why.join(' '))}</span></p>`).join('')}</div>` : ''}
        <p class="small muted">A suggestion only: any legal move is fine.</p>
      </div></div>`;
  markHint();
  placeHint(true);
}

/**
 * Put the hint panel beside what it suggests, as the tutorial's tooltip sits
 * beside what it points at: the move's locations, else the suggested card,
 * covering as little of those and of the hand as it can. In the lower half
 * it hangs from its bottom edge, so opening grows it upward. Phones: a sheet
 * placed by its class. @param {boolean} [fresh] a new hint: free to move
 */
function placeHint(fresh = false) {
  const panel = $('hint-overlay');
  const h = ui.hints.hint;
  if (panel.hidden || !h || window.matchMedia('(max-width: 600px), (hover: none) and (pointer: coarse)').matches) { panel.style.left = panel.style.top = panel.style.bottom = ''; return; }
  const vw = window.innerWidth, vh = window.innerHeight, gap = 12, m = 12;
  const rect = (/** @type {Element} */ x) => x.getBoundingClientRect();
  const tiles = h.tiles.map((l) => document.querySelector(`#board [data-tile="${CSS.escape(l)}"] .hex`)).filter((x) => !!x).map((x) => rect(/** @type {Element} */ (x)));
  const cards = [...document.querySelectorAll('#hand .card.is-suggested')].map(rect);
  const hand = [...document.querySelectorAll('#hand .card, #dock')].map(rect);
  const anchors = (tiles.length ? tiles : cards).filter((r) => r.bottom > 0 && r.top < vh);
  const avoid = [...tiles, ...cards, ...hand];
  const pw = panel.offsetWidth, ph = panel.offsetHeight;
  /** @type {number[][]} */
  const spots = [];
  if (anchors.length) {
    const b = { left: Math.min(...anchors.map((r) => r.left)), top: Math.min(...anchors.map((r) => r.top)), right: Math.max(...anchors.map((r) => r.right)), bottom: Math.max(...anchors.map((r) => r.bottom)) };
    const cx = (b.left + b.right) / 2 - pw / 2, cy = (b.top + b.bottom) / 2 - ph / 2;
    spots.push([b.right + gap, cy], [b.left - gap - pw, cy], [cx, b.top - gap - ph], [cx, b.bottom + gap]);
  }
  spots.push([vw - pw - m, 56], [m, 56]);
  const fit = spots.map(([x, y]) => [Math.max(m, Math.min(vw - pw - m, x)), Math.max(m, Math.min(vh - ph - m, y))]);
  const covered = (/** @type {number} */ x, /** @type {number} */ y) => avoid.reduce((n, r) => n + Math.max(0, Math.min(x + pw, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + ph, r.bottom) - Math.max(y, r.top)), 0);
  let best = fit[0], least = Infinity;
  for (const [x, y] of fit) { const c = covered(x, y); if (c < least - 1) { least = c; best = [x, y]; } }
  if (!fresh && panel.dataset.placed) return; // stays put while you read it (and while it opens)
  panel.dataset.placed = '1';
  panel.style.left = `${Math.round(best[0])}px`;
  if (best[1] + ph / 2 > vh / 2) { panel.style.top = ''; panel.style.bottom = `${Math.round(vh - best[1] - ph)}px`; }
  else { panel.style.bottom = ''; panel.style.top = `${Math.round(best[1])}px`; }
}

/**
 * Mark the hint on the table (designer, 2026-10-11: every click needed to
 * follow it): the move's locations in their hover light; the card with its
 * HINT tab naming the way to play it and that button outlined; then, once the
 * card is picked, the next thing to click as the target is built (a location,
 * a group, a faction, an arrow, or Done), step by step until it plays.
 */
function markHint() {
  for (const x of document.querySelectorAll('.is-suggested, .is-hint-next')) x.classList.remove('is-suggested', 'is-hint-next');
  for (const x of document.querySelectorAll('#hand .card[data-hint]')) x.removeAttribute('data-hint');
  const h = ui.hints.on ? ui.hints.hint : null;
  if (!h) return;
  const q = (/** @type {string} */ sel) => document.querySelector(sel);
  const tile = (/** @type {string} */ l) => q(`#board [data-tile="${CSS.escape(l)}"]`);
  for (const id of h.keep ?? []) q(`#hand .card[data-card="${CSS.escape(id)}"]`)?.classList.add('is-suggested');
  for (const l of h.tiles) tile(l)?.querySelector('.hex')?.classList.add('is-suggested');
  const m = h.move;
  if (m?.type === 'pass') q('[data-action="pass"]')?.classList.add('is-hint-next');
  if (m?.type === 'grow') tile(m.location)?.classList.add('is-hint-next');
  if (m?.type !== 'play') return;
  const card = q(`#hand .card[data-card="${CSS.escape(m.card)}"]`);
  const mode = m.use === 'sway' ? 'sway' : m.target?.mode;
  card?.classList.add('is-suggested');
  if (card instanceof HTMLElement) card.dataset.hint = mode === 'sway' ? ` · ${card.querySelector('.card-opt[data-action="sway"]')?.textContent?.trim() ?? 'SWAY'}` : mode === 'faction' ? ' · FAC' : mode === 'location' ? ' · LOC' : '';
  if (ui.choosing !== m.card || m.use === 'sway') {
    // The way to play it: its LOC, FAC or +N button; an unsuited card has none, so the card itself is the click.
    if (mode) card?.querySelector(mode === 'sway' ? '.card-opt[data-action="sway"]' : `.card-opt[data-mode="${mode}"]`)?.classList.add('is-suggested');
    else card?.classList.add('is-hint-next');
    return;
  }
  // A card played for no effect (nothing to target): its ⊘ button is the click.
  if (!m.target) { q('[data-action="target-none"]')?.classList.add('is-hint-next'); return; }
  const next = hintNext(m.target);
  if (!next) return;
  if (next.kind === 'tile') tile(next.location)?.classList.add('is-hint-next');
  if (next.kind === 'group') q(`#board .token-stack[data-location="${CSS.escape(next.location)}"][data-faction="${CSS.escape(next.faction)}"]`)?.classList.add('is-hint-next');
  if (next.kind === 'faction') {
    q(`#factions .faction-row[data-faction="${CSS.escape(next.faction)}"]`)?.classList.add('is-hint-next');
    for (const x of document.querySelectorAll(`#board .token-stack[data-faction="${CSS.escape(next.faction)}"][data-action="pick-faction"]`)) x.classList.add('is-hint-next');
  }
  if (next.kind === 'direction') q(`[data-action="pick-direction"][data-direction="${CSS.escape(next.direction)}"]`)?.classList.add('is-hint-next');
  if (next.kind === 'skip') q('[data-action="skip"]')?.classList.add('is-hint-next');
}

/**
 * The next click towards the hint's target, from the step the table is on
 * (the same steps applyPick fills in). @param {import('./engine.js').Target} ht
 * @returns {{ kind: 'tile', location: string } | { kind: 'group', location: string, faction: string } | { kind: 'faction', faction: string } | { kind: 'direction', direction: string } | { kind: 'skip' } | null}
 */
function hintNext(ht) {
  const c = currentChoice();
  const t = ui.target;
  if (!c) return null;
  const real = (/** @type {string[] | undefined} */ xs) => (xs ?? []).filter((l) => l !== '__stop');
  if (c.kind === 'location') {
    /** @type {string | undefined} */
    let l;
    if (c.key === 'path') l = real(ht.path)[real(t.path).length];
    else if (c.key === 'from') l = real(ht.from)[real(t.from).length];
    else if (c.key === 'to' && t.moves?.length) l = ht.moves?.[t.moves.length - 1]?.to;
    else l = /** @type {string | undefined} */ (ht[c.key]);
    return l && c.options.includes(l) ? { kind: 'tile', location: l } : c.optional ? { kind: 'skip' } : null;
  }
  if (c.kind === 'split') {
    const l = c.options.find((x) => (t.split?.[x] ?? 0) < (ht.split?.[x] ?? 0));
    return l ? { kind: 'tile', location: l } : null;
  }
  if (c.kind === 'group') {
    const g = c.key === 'lure' ? { location: ht.from?.[0] ?? '', faction: ht.faction ?? '' }
      : c.key === 'move' ? ht.moves?.[(t.moves ?? []).length]
      : { location: ht.location ?? '', faction: ht.faction ?? '' };
    return g && c.options.some((o) => o.location === g.location && o.faction === g.faction) ? { kind: 'group', location: g.location, faction: g.faction } : c.optional ? { kind: 'skip' } : null;
  }
  if (c.kind === 'faction') {
    const f = /** @type {string | undefined} */ (ht[c.key ?? 'faction']);
    return f ? { kind: 'faction', faction: f } : null;
  }
  if (c.kind === 'direction') return ht.direction ? { kind: 'direction', direction: ht.direction } : null;
  return null;
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
    && !event.target.closest('[data-action], .card-selected, #dock, .side-stack, .overlay, .topbar-buttons, .tut')) {
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
  if (action === 'sway') {
    ui.choosing = null;
    ui.target = {};
    return sendMove({ type: 'play', card, use: 'sway' });
  }
  if (action === 'back') {
    // Undo the last pick (a reading counts); with nothing left to undo, put the card down.
    const last = ui.choosing ? ui.undo.pop() : undefined;
    if (last) {
      ui.target = last;
      return render();
    }
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
    const before = structuredClone(t);
    if (!applyPick(t, action ?? '', target)) return;
    ui.undo.push(before);
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
    for (const id of ['sway', 'score']) document.getElementById(id)?.classList.toggle('is-open', ui.sideOpen === id);
    return;
  }
  if (action === 'set-mode') {
    // Picking or switching the reading (on the card) restarts the target in that reading.
    ui.choosing = target.dataset.card ?? ui.choosing;
    ui.undo.push(structuredClone(ui.target));
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
  if (action === 'cycle-speed') return cycleSpeed();
  if (action === 'toggle-overlay') {
    if (target.dataset.target === 'hint-overlay') {
      // The Hints button cycles off → marks → full; the panel's × drops to marks.
      if (target.id === 'hint-button') setHints(HINT_MODES[(HINT_MODES.indexOf(ui.hints.mode) + 1) % HINT_MODES.length]);
      else setHints('marks');
      return;
    }
    const panel = document.getElementById(target.dataset.target ?? '');
    if (!panel) return;
    const opening = panel.hidden;
    for (const id of ['log-overlay', 'chat-overlay', 'hint-overlay']) {
      const other = document.getElementById(id);
      if (other) other.hidden = true; // the hint panel steps aside until the next hint
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

/** Cards built one step at a time: each step shows on the board as soon as it is picked. */
const STEPWISE = ['sow', 'split', 'broadcast', 'move-sway'];

/**
 * The view as the table shows it: the real one, or, while a step-by-step
 * card's target is being built, with the steps picked so far already carried
 * out on the board and in standing (Track leaves its token and sway at
 * each step). Nothing is sent until the target is finished, so Back still
 * undoes a step.
 * @returns {PlayerView}
 */
function shownView() {
  const view = /** @type {PlayerView} */ (ui.view);
  const card = ui.choosing ? cardById(ui.choosing) : null;
  const t = finish(ui.target);
  const started = t.path?.length || Object.keys(t.split ?? {}).length || t.from?.length || t.moves?.some((m) => m.to);
  if (!card || !STEPWISE.includes(card.action ?? '') || !started) return view;
  if (t.moves) t.moves = t.moves.filter((m) => m.to);
  try {
    const { board, players } = previewTarget(view, view.you, card.id, t);
    return /** @type {PlayerView} */ (/** @type {unknown} */ ({ ...view, board, players: Object.fromEntries(Object.entries(view.players).map(([id, p]) => [id, { ...p, standing: players[id].standing }])) }));
  } catch {
    return view;
  }
}

/**
 * Cards that act on a whole region: hovering a candidate location lights every
 * location the card will touch, in the hexes' hover art (the region it locks,
 * draws from or shifts; for the Summoning Circle, the neighbouring regions it
 * pulls from), so it's plain that the card reaches a region, not one place.
 * @param {HTMLElement | null} el  the hovered pick, if any
 */
function lightRegions(el) {
  for (const hex of document.querySelectorAll('#board .hex.is-region')) hex.classList.remove('is-region');
  const view = ui.view;
  if (!el || !view || !ui.choosing || el.dataset.action !== 'pick-location') return;
  const card = cardById(ui.choosing);
  const loc = el.dataset.location ?? '';
  const map = /** @type {{ regions: Record<string, { neighbours: string[] }>, locations: Record<string, { region: string }> }} */ (/** @type {unknown} */ (spec.map));
  const region = map.locations[loc]?.region;
  if (!region) return;
  const inRegions = (/** @type {string[]} */ rs) => Object.keys(map.locations).filter((l) => rs.includes(map.locations[l].region));
  /** @type {string[]} */
  let lit = [];
  const step = currentChoice();
  const targetStep = step && step.kind !== 'mode' && 'key' in step ? step.key === 'location' : true;
  if (!targetStep) return;
  if (card.action === 'lockdown' || card.action === 'gather-region' || card.action === 'pit-fall') lit = inRegions([region]);
  else if (card.action === 'conveyor' && (ui.target.mode ?? 'location') === 'location') lit = inRegions([region]);
  else if (card.action === 'gather-neighbours') lit = [loc, ...inRegions(map.regions[region].neighbours)];
  for (const l of lit) document.querySelector(`#board [data-tile="${CSS.escape(l)}"] .hex`)?.classList.add('is-region');
}

/**
 * Outcome preview: hovering a lit choice that would finish the target (or
 * extend a path or a list of sources) shows on each hex what the play would
 * change: +n / -n tokens per faction, and your sway placed.
 * @param {PointerEvent} event
 */
function onPreview(event) {
  const el = event.target instanceof HTMLElement ? /** @type {HTMLElement | null} */ (event.target.closest('#board [data-action^="pick-"], #factions [data-action^="pick-"]')) : null;
  if (el === ui.previewing) return;
  ui.previewing = el;
  for (const box of document.querySelectorAll('#board .hex-preview')) box.innerHTML = '';
  lightRegions(el);
  const view = ui.view;
  if (!el || !view || !ui.choosing) return;
  const t = structuredClone(ui.target);
  if (!applyPick(t, el.dataset.action ?? '', el)) return;
  const done = finish(t);
  if (checkTarget(/** @type {any} */ (view), view.you, cardById(ui.choosing), done)) return;
  const after = previewTarget(view, view.you, ui.choosing, done).board;
  const now = shownView().board;
  for (const [loc, place] of Object.entries(after)) {
    const was = now[loc];
    const chips = view.factions.map((f) => [f, (place.tokens[f] ?? 0) - (was.tokens[f] ?? 0)]).filter(([, n]) => n)
      .map(([f, n]) => `<span class="preview-chip ${Number(n) > 0 ? 'is-up' : 'is-down'}">${tokenHtml(String(f), 1)}${Number(n) > 0 ? '+' : '−'}${Math.abs(Number(n))}</span>`);
    const mine = (place.sway[view.you] ?? 0) - (was.sway[view.you] ?? 0);
    if (mine) chips.push(`<span class="preview-chip ${mine > 0 ? 'is-up' : 'is-down'}">${cubeHtml(colourOf(view.you), 8)}${mine > 0 ? '+' : '−'}${Math.abs(mine)}</span>`);
    const box = document.querySelector(`#board [data-tile="${CSS.escape(loc)}"] .hex-preview`);
    if (box) box.innerHTML = chips.join('');
  }
}

/**
 * Apply one board pick (a lit location, group, faction or direction, or Done)
 * to a target being built. Mutates `t`; false if the pick fits no step.
 * @param {import('./engine.js').Target} t @param {string} action @param {HTMLElement} el
 */
function applyPick(t, action, el) {
  const loc = el.dataset.location ?? '';
  let choice = currentChoice(t);
  // A suit card's reading is decided by what is clicked: one of its
  // locations (location target) or one of its faction's groups (faction).
  if (choice?.kind === 'mode') {
    const asLocation = currentChoice({ ...t, mode: 'location' });
    const asFaction = currentChoice({ ...t, mode: 'faction' });
    const fits = (/** @type {ReturnType<typeof currentChoice>} */ c) => !!c && ((action === 'pick-location' && (c.kind === 'location' || c.kind === 'split') && c.options.includes(loc))
      || (action === 'pick-group' && c.kind === 'group' && c.options.some((g) => g.location === loc && g.faction === el.dataset.faction))
      || (action === 'pick-faction' && c.kind === 'faction' && c.options.includes(el.dataset.faction ?? '')));
    t.mode = fits(asLocation) ? 'location' : fits(asFaction) ? 'faction' : t.mode;
    if (!t.mode) return false;
    choice = currentChoice(t);
  }
  if (action === 'pick-faction') t[choice?.kind === 'faction' ? choice.key ?? 'faction' : 'faction'] = el.dataset.faction;
  else if (action === 'pick-direction') t.direction = el.dataset.direction;
  else if (action === 'pick-group' && choice?.kind === 'group') {
    if (choice.key === 'lure') Object.assign(t, { faction: el.dataset.faction, from: [loc] });
    else if (choice.key === 'move') t.moves = [...(t.moves ?? []), { location: loc, faction: el.dataset.faction ?? '', to: '' }];
    else Object.assign(t, { location: loc, faction: el.dataset.faction });
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
  return true;
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
    ui.undo = [];
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
    // Slop: a little room beside the spread cards, so the hand doesn't drop at its edges but never spans the screen.
    const left = Math.min(...boxes.map((b) => b.left)) - 24;
    const right = Math.max(...boxes.map((b) => b.right)) + 24;
    const top = Math.min(...boxes.map((b) => b.top)) - 16;
    const inside = at.x >= left && at.x <= right && at.y >= top;
    if (!inside && !onCard) {
      hand.classList.remove('is-hovering');
      activate(null);
    }
  };
  // A click in the slop (anywhere not on a card) drops the hand; it rises again only from a card.
  document.addEventListener('pointerdown', (event) => {
    const hand = document.getElementById('hand');
    if (!hand?.classList.contains('is-hovering') || (event.target instanceof Element && event.target.closest('#hand .card'))) return;
    hand.classList.remove('is-hovering');
    hand.querySelectorAll('.card').forEach((x) => x.classList.remove('is-active'));
  });
  document.addEventListener('pointermove', (event) => {
    at = { x: event.clientX, y: event.clientY };
    if (!queued) {
      queued = true;
      requestAnimationFrame(check);
    }
  }, { passive: true });
}

/**
 * What the tutorial (tutorial.js) may do with the table: show views (animated,
 * in order), take the player's moves, and set the few display flags above.
 * @typedef {typeof tableHooks} TableHooks
 */
const tableHooks = {
  ui,
  render,
  toast,
  /** @param {PlayerView} view @param {string[]} [bots] @param {{ instant?: boolean, speed?: number }} [o] */
  present: (view, bots = ui.bots, o = {}) => { ui.bots = bots; return receiveState(view, view.seating, !!o.instant, o.speed); },
  /** How the hand sits: collapsed out of the way, raised to be read, or at rest. @param {'tuck' | 'raise' | 'rest'} mode */
  hand: (mode) => { if (ui.tuck !== (mode === 'tuck') || ui.raise !== (mode === 'raise')) { ui.tuck = mode === 'tuck'; ui.raise = mode === 'raise'; renderHand(); } },
  /** Tick the cards to keep in the draft. @param {string[]} keep */
  setKeep: (keep) => { ui.keep = keep.slice(); ui.keepFor = ui.view?.me.kept.length ?? -1; renderPhase(); },
  /** Select a card with a finished target (shown as chosen), or put it down. @param {string | null} card @param {import('./engine.js').Target} [target] */
  choose: (card, target = {}) => { ui.choosing = card; ui.target = structuredClone(target); ui.undo = []; render(); },
  /** Hints on or off, and where they come from (the tutorial's own). @param {boolean} on @param {(() => import('./hints.js').Hint | null)} [source] */
  hints: (on, source) => { if (source) ui.hints.source = source; setHints(on ? 'full' : 'off'); },
};

function main() {
  watchHand();
  $('hint-overlay').addEventListener('click', (event) => { if (!(event.target instanceof HTMLElement && event.target.closest('button'))) $('hint-overlay').classList.toggle('is-open'); });
  let hintQueued = false;
  const replace = () => { if (hintQueued) return; hintQueued = true; requestAnimationFrame(() => { hintQueued = false; placeHint(true); }); };
  globalThis.addEventListener?.('resize', replace);
  globalThis.addEventListener?.('scroll', replace, { passive: true });
  document.addEventListener('click', onClick);
  document.addEventListener('pointerover', onPreview);
  document.addEventListener('click', onCardClick);
  $('chat-form').addEventListener('submit', onChatSubmit);
  render();
  let saved = null;
  try { saved = localStorage.getItem('motw-hints'); } catch { /* a convenience only */ }
  if (!ui.tutorial && (saved === 'marks' || saved === 'full')) { ui.hints.mode = saved; ui.hints.on = true; }
  if (ui.tutorial) return void import('./tutorial.js').then((m) => m.start(tableHooks));
  if (ui.hotseat.enabled) return void loadHotseat();
  if (ui.token) connect();
}

main();
