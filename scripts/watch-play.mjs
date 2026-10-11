// @ts-check
/**
 * Play a table in headless Chrome and watch for stalls (prototype tooling,
 * not rules; designer, 2026-10-11: test runs must not hang). Starts a bot
 * game on the dev server (or opens the tutorial), plays the human seat (draft:
 * the first cards; play: the hint's move when there is one, else pass), and
 * stops on its own:
 *   - when the game ends (exit 0), or after --rounds rounds;
 *   - when nothing on the page has changed for --idle seconds (exit 2), with a
 *     report of what's showing, whose move it is and any page errors;
 *   - after --max seconds in all (exit 3).
 * Chrome is always closed. Needs `npm run dev` (port 8788). Replaces the dev
 * server's current game (the designer allows it).
 *
 *   node scripts/watch-play.mjs [--tutorial] [--rounds=1] [--idle=20] [--max=600] [--shots=dir] [--seed=7]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (/** @type {string} */ k, /** @type {string} */ d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const TUTORIAL = process.argv.includes('--tutorial');
const ROUNDS = Number(arg('rounds', '1')), IDLE = Number(arg('idle', '20')) * 1000, MAX = Number(arg('max', '600')) * 1000, SHOTS = arg('shots', ''), SEED = Number(arg('seed', '7'));
const BASE = 'http://localhost:8788';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9400 + Math.floor(Math.random() * 400);
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1440,900', `--user-data-dir=/tmp/motw-watch-${PORT}`, 'about:blank'], { stdio: 'ignore' });
/** @param {number} code @param {string} why */
function finish(code, why) {
  console.log(`${code === 0 ? 'DONE' : 'STOP'} (${code}): ${why}`);
  try { chrome.kill(); } catch { /* gone */ }
  process.exit(code);
}
process.on('SIGINT', () => finish(130, 'interrupted'));
setTimeout(() => finish(3, `over ${MAX / 1000}s in all`), MAX).unref();

/** @type {WebSocket | undefined} */
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const page = list.find((/** @type {any} */ t) => t.type === 'page'); if (page) ws = new WebSocket(page.webSocketDebuggerUrl); } catch { /* not up yet */ }
  if (!ws) await sleep(250);
}
if (!ws) finish(4, 'Chrome did not start');
const sock = /** @type {WebSocket} */ (ws);
await new Promise((r) => sock.addEventListener('open', r));
let id = 0;
/** @type {Map<number, (m: any) => void>} */
const waiting = new Map();
/** @type {string[]} */
const errors = [];
sock.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && waiting.has(m.id)) { /** @type {(m: any) => void} */ (waiting.get(m.id))(m); waiting.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errors.push(m.params.args.map((/** @type {any} */ a) => a.value ?? a.description).join(' '));
});
/** @param {string} method @param {object} [params] @returns {Promise<any>} */
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
/** @param {string} expression */
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

let url = `${BASE}/tutorial`;
if (!TUTORIAL) {
  const made = await (await fetch(`${BASE}/admin/new-game`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ players: ['Me', 'Ash', 'Bea', 'Cy'], bots: ['Ash', 'Bea', 'Cy'], force: true, seed: SEED }) })).json();
  url = made.links.find((/** @type {any} */ l) => l.player === 'Me').url.replace(/^https?:\/\/[^/]+/, BASE);
}
// Hints on (full), so the human seat can follow them: set before the table loads.
await send('Page.navigate', { url: `${BASE}/host` });
await sleep(800);
await ev(`localStorage.setItem('motw-hints', 'full')`);
await send('Page.navigate', { url });
await sleep(2500);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let shots = 0;
const shot = async (/** @type {string} */ name) => { if (!SHOTS) return; const d = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${SHOTS}/${String(shots++).padStart(3, '0')}-${name}.png`, Buffer.from(d.result.data, 'base64')); };

// What the page shows, and a signature of it: if the signature stops changing, the game has stalled.
const LOOK = `(() => {
  const q = (s) => document.querySelector(s);
  const vis = (s) => { const e = q(s); return !!e && !e.hidden; };
  const text = (s) => (q(s)?.innerText ?? '').replace(/\\s+/g, ' ').trim();
  return {
    phase: text('.phase-label'), bar: text('#phase'), tip: vis('.tut-tip') ? text('.tut-tip h3') : vis('.tut-wrap') ? text('.tut-modal h2') : '',
    guide: vis('#guide') ? text('#guide') : '', frame: vis('#round-frame') ? text('#round-frame') : '', hint: text('.hint-title'),
    pick: q('[data-action=pick]') ? !q('[data-action=pick]').disabled : null, pass: !!q('[data-action=pass]'), next: !!q('[data-tut=next]'),
    board: q('#board')?.innerHTML.length ?? 0, flying: document.querySelectorAll('.flight-layer *').length,
  };
})()`;
let lastSig = '', lastChange = Date.now(), round = 0, said = '';
for (;;) {
  const s = await ev(LOOK);
  if (!s) { await sleep(500); continue; }
  const sig = JSON.stringify([s.phase, s.bar, s.tip, s.guide, s.frame, s.board, s.flying, s.pick]);
  if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
  const story = s.guide || s.frame || s.tip;
  if (story && story !== said) { said = story; console.log(`· ${story.slice(0, 160)}`); if (/plays|spends|fights/i.test(story)) await shot('story'); }
  const r = Number(/Round (\d+)/.exec(s.phase)?.[1] ?? 0);
  if (r !== round) { round = r; console.log(`ROUND ${r}`); if (r > ROUNDS) finish(0, `played ${ROUNDS} round(s)`); }
  if (/Game over/.test(s.phase) || /That was a round/.test(s.tip)) finish(0, s.tip || 'game over');
  if (Date.now() - lastChange > IDLE) {
    await shot('stalled');
    console.log(JSON.stringify(s, null, 1));
    if (errors.length) console.log(`page errors:\n  ${errors.slice(-8).join('\n  ')}`);
    finish(2, `nothing changed for ${IDLE / 1000}s`);
  }
  // The human seat's move: Next on a tutorial step; the draft's first cards; the hint's marks, else pass.
  if (s.tip && s.next) await ev(`document.querySelector('[data-tut=next]')?.click()`);
  else if (s.pick === false) await ev(`[...document.querySelectorAll('#hand .card:not(.card-ticked)')][0]?.click()`);
  else if (s.pick === true) await ev(`document.querySelector('[data-action=pick]').click()`);
  else if (!s.guide && !s.frame) {
    const did = await ev(`(() => { const n = document.querySelector('.is-hint-next'); if (n) { n.click(); return 'next'; } const o = document.querySelector('#hand .card.is-suggested .card-opt.is-suggested'); if (o) { o.click(); return 'mode'; } return ''; })()`);
    if (!did && s.pass) await ev(`document.querySelector('[data-action=pass]').click()`);
  }
  await sleep(700);
}
