// @ts-check
/**
 * Headless render test for the table UI. Stubs just enough of the DOM and
 * WebSocket for app.js to boot, then feeds it real playerViews for every phase
 * and checks each panel renders without throwing.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyMove, playerView, factionById } from '../public/engine.js';

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
      documentElement: new FakeElement(),
      /** @param {string} id */
      getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, new FakeElement());
        return elements.get(id);
      },
      addEventListener: () => {},
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

/** @param {GameState} state */
const everyoneReady = (state) => PLAYERS.reduce((next, playerId) => applyMove(next, { playerId, move: { type: 'ready' } }), state);

// ---------------------------------------------------------------------------
// Every phase
// ---------------------------------------------------------------------------

test('the ready phase renders the board, the seats, and the ready button', () => {
  const state = createGame({ seed: 3, players: PLAYERS });
  push(state);
  assert.match(html('header'), /MONSTER OF THE WEEK/);
  for (const id of state.factions) assert.ok(html('board').includes(factionById(id).name.replace("'", '&#39;')), id);
  assert.match(html('board'), /Lighthouse/);
  assert.match(html('board'), /src="\/assets\/sprites\/lighthouse.png"/);
  for (const id of PLAYERS) assert.ok(html('players').includes(id));
  assert.match(html('phase'), /data-action="ready"/);
});

test('after committing, the phase panel names the seats still deciding', () => {
  const state = applyMove(createGame({ seed: 3, players: PLAYERS }), { playerId: ME, move: { type: 'ready' } });
  push(state);
  assert.doesNotMatch(html('phase'), /data-action="ready"/);
  assert.match(html('phase'), /Waiting for/);
  assert.match(html('phase'), /<b>Bob<\/b>/);
});

test('the log and the ended phase render', () => {
  let state = createGame({ seed: 3, players: PLAYERS });
  while (state.phase !== 'ended') state = everyoneReady(state);
  push(state);
  assert.match(html('phase'), /Game over/);
  assert.match(html('log'), /Round 1/);
});
