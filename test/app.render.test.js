// @ts-check
/**
 * Headless render test for the table UI. Stubs just enough of the DOM and
 * WebSocket for app.js to boot, then feeds it real playerViews for every phase
 * and checks each panel renders without throwing.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyMove, playerView, factionById } from '../public/engine.js';
import { botMove } from '../public/bots.js';

/** @typedef {import('../public/engine.js').GameState} GameState */

const PLAYERS = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'];
const ME = 'Ann';

// ---------------------------------------------------------------------------
// Minimal DOM + WebSocket stubs
// ---------------------------------------------------------------------------

class FakeElement {
  constructor() {
    this.innerHTML = '';
    this.textContent = '';
    this.className = '';
    this.hidden = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.value = '';
    this.classList = { toggle() {} };
    this.style = { setProperty() {} };
  }
  addEventListener() {}
}

/** @type {Map<string, FakeElement>} */
const elements = new Map();
/** @type {((event: { data: string }) => void) | null} */
let onMessage = null;

class FakeWebSocket {
  static OPEN = 1;
  constructor() {
    this.readyState = FakeWebSocket.OPEN;
    /** @type {string[]} */
    this.sent = [];
  }
  /** @param {string} type @param {(event: any) => void} handler */
  addEventListener(type, handler) {
    if (type === 'message') onMessage = handler;
    if (type === 'open') handler({});
  }
  /** @param {string} data */
  send(data) {
    this.sent.push(data);
  }
}

before(async () => {
  Object.assign(globalThis, {
    location: { pathname: '/p/test-token', protocol: 'http:', host: 'localhost' },
    WebSocket: FakeWebSocket,
    HTMLElement: class {},
    HTMLSelectElement: class {},
    HTMLInputElement: class {},
    document: {
      documentElement: Object.assign(new FakeElement(), { style: { setProperty: () => {} } }),
      /** @param {string} id */
      getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, new FakeElement());
        return elements.get(id);
      },
      addEventListener: () => {},
      querySelectorAll: () => [],
    },
  });
  await import('../public/app.js');
});

/** @param {GameState} state */
function push(state) {
  if (!onMessage) throw new Error('app did not open a websocket');
  onMessage({ data: JSON.stringify({ type: 'state', view: playerView(state, ME), online: PLAYERS, bots: [] }) });
}

/** @param {string} id */
const html = (id) => elements.get(id)?.innerHTML ?? '';

/** Bots play from this state until `stop` holds. @param {GameState} state @param {(s: GameState) => boolean} stop */
function playUntil(state, stop) {
  let s = state;
  for (let i = 0; i < 20000 && !stop(s); i++) {
    const pid = s.seating.find((id) => botMove(s, { playerId: id, rng: Math.random }));
    if (!pid) break;
    const move = botMove(s, { playerId: pid, rng: Math.random });
    if (move) s = applyMove(s, { playerId: pid, move });
  }
  return s;
}

// ---------------------------------------------------------------------------
// Every phase
// ---------------------------------------------------------------------------

test('the draft renders the island, the seats and the cards to keep', () => {
  const state = createGame({ seed: 3, players: PLAYERS });
  push(state);
  assert.match(html('header'), /MONSTER OF THE WEEK/);
  for (const id of state.factions) assert.ok(html('board').includes(factionById(id).name.replace("'", '&#39;')), id);
  assert.match(html('board'), /src="\/assets\/hexes\/lighthouse.png"/);
  assert.match(html('board'), /Total presence <b>35<\/b>/);
  for (const id of PLAYERS) assert.ok(html('players').includes(id));
  assert.match(html('hand'), /data-card-mode="keep"/);
  for (const c of state.players[ME].batch) assert.ok(html('hand').includes(`data-card="${c}"`));
});

test('the play phase renders a hand, or who is to act', () => {
  const state = playUntil(createGame({ seed: 5, players: PLAYERS }), (s) => s.phase === 'play');
  push(state);
  assert.match(html('phase'), /bar-text/);
});

test('the log and the ended phase render', () => {
  const state = playUntil(createGame({ seed: 3, players: PLAYERS }), (s) => s.phase === 'ended');
  push(state);
  assert.match(html('phase'), /\bwins?\b/);
  assert.match(html('phase'), /win/);
  assert.match(html('phase'), /(winner)/);
  assert.match(html('log'), /cards dealt/);
});
