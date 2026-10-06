// @ts-check
/**
 * End-to-end smoke test against a running server (default: wrangler dev on :8788).
 * Creates a game through the admin API, connects one websocket per seat, and
 * plays bot moves until the game ends. Checks that every seat sees the end and
 * that no view carries another seat's private part.
 *
 *   npm run smoke            (reads ADMIN_SECRET from the env or .dev.vars)
 */
import { readFileSync } from 'node:fs';

/** @typedef {import('../public/engine.js').PlayerView} PlayerView */

const BASE = process.argv[2] ?? process.env.BASE ?? 'http://localhost:8788';
const SECRET = process.env.ADMIN_SECRET ?? readDevVarsSecret() ?? '';
const PLAYERS = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'];
const MOVE_TIMEOUT_MS = 5000;

function readDevVarsSecret() {
  try {
    const line = readFileSync('.dev.vars', 'utf8').split('\n').find((entry) => entry.startsWith('ADMIN_SECRET='));
    return line ? line.slice('ADMIN_SECRET='.length).trim() : undefined;
  } catch {
    return undefined;
  }
}

/** @param {string} message @returns {never} */
function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** @param {unknown} condition @param {string} message */
function check(condition, message) {
  if (!condition) fail(message);
}

class Seat {
  /** @param {{ name: string, url: string }} options */
  constructor(options) {
    this.name = options.name;
    /** @type {PlayerView | null} */
    this.view = null;
    /** @type {string[]} */
    this.errors = [];
    const token = options.url.split('/p/')[1];
    this.socket = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/${token}`);
    this.socket.addEventListener('message', (event) => this.receive(String(event.data)));
    this.ready = new Promise((resolve) => this.socket.addEventListener('open', resolve));
    /** @type {(() => void)[]} */
    this.waiters = [];
  }

  /** @param {string} raw */
  receive(raw) {
    const message = JSON.parse(raw);
    if (message.type === 'state') {
      this.view = message.view;
      const keys = Object.keys(message.view);
      check(message.view.you === this.name, `${this.name} received a view for ${message.view.you}`);
      check(keys.includes('me'), `${this.name}'s view has no private part`);
      for (const waiter of this.waiters.splice(0)) waiter();
    }
    if (message.type === 'error') this.errors.push(message.reason);
  }

  /** @param {(view: PlayerView) => boolean} predicate */
  until(predicate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} timed out waiting for state`)), MOVE_TIMEOUT_MS);
      const test = () => {
        if (this.view && predicate(this.view)) {
          clearTimeout(timer);
          resolve(this.view);
        } else this.waiters.push(test);
      };
      test();
    });
  }
}

async function main() {
  const response = await fetch(`${BASE}/admin/new-game`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(SECRET ? { authorization: `Bearer ${SECRET}` } : {}) },
    body: JSON.stringify({ players: PLAYERS, force: true, seed: 7 }),
  });
  if (!response.ok) fail(`new-game failed: ${response.status} ${await response.text()}`);
  const { links } = /** @type {{ links: { player: string, url: string }[] }} */ (await response.json());
  const seats = links.map((link) => new Seat({ name: link.player, url: link.url }));
  await Promise.all(seats.map((seat) => seat.ready));
  await Promise.all(seats.map((seat) => seat.until(() => true)));

  // Every seat is human here; a simple policy drives them from their views:
  // keep the first cards in the draft, open with a marked card when first,
  // confirm your own action, grow at the first spot, and otherwise pass.
  /** @param {PlayerView} v @returns {any} */
  const policy = (v) => {
    if (v.phase === 'draft') return v.me.picked ? null : { type: 'pick', keep: [...v.me.kept, ...v.me.batch].slice(0, v.me.kept.length + 1) };
    if (v.phase === 'growth') return v.growing && v.growing.leaders[v.growing.next % v.growing.leaders.length] === v.you ? { type: 'grow', location: Object.keys(v.growing.due)[0] } : null;
    if (v.phase !== 'play') return null;
    if (v.pending) return v.pending.player === v.you ? { type: 'confirm' } : null;
    if (v.toAct !== v.you) return null;
    const marked = v.first === v.you && !v.opened ? v.me.hand.find((c) => /^extra-[a-d]$/.test(c)) : null;
    return marked ? { type: 'play', card: marked, use: 'action', target: null } : { type: 'pass' };
  };
  for (let step = 0; step < 2000; step++) {
    const view = seats[0].view;
    if (!view) fail('no view');
    if (view.phase === 'ended') break;
    const actor = seats.find((seat) => seat.view && policy(seat.view));
    if (!actor?.view) fail(`nobody can act in ${view.phase}, round ${view.round}: ${JSON.stringify({ toAct: view.toAct, first: view.first, opened: view.opened, pending: view.pending, seats: seats.map((s) => [s.name, s.view?.you, s.view?.toAct, !!s.view?.pending, JSON.stringify(s.view ? policy(s.view) : null)]) })}`);
    const key = (/** @type {PlayerView} */ v) => JSON.stringify([v.round, v.phase, v.pending, v.toAct, v.log.at(-1)?.events.length, v.seating.map((id) => v.players[id].picked)]);
    const before = key(actor.view);
    const sent = policy(actor.view);
    await new Promise((resolve) => setTimeout(resolve, 260)); // stay under the per-seat rate limit (4 a second)
    actor.socket.send(JSON.stringify({ type: 'move', move: sent }));
    const after = key(/** @type {PlayerView} */ (await actor.until((next) => key(next) !== before).catch(() => fail(`${actor.name}'s move ${JSON.stringify(sent)} changed nothing; errors: ${actor.errors.join('; ')}`))));
    // Let every seat catch up to the same state before choosing the next actor.
    await Promise.all(seats.map((seat) => seat.until((next) => key(next) === after)));
  }

  await Promise.all(seats.map((seat) => seat.until((view) => view.phase === 'ended')));
  for (const seat of seats) check(seat.errors.length === 0, `${seat.name} saw errors: ${seat.errors.join('; ')}`);
  for (const seat of seats) seat.socket.close();
  console.log(`✓ played a whole game over websockets with ${seats.length} seats`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
