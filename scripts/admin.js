// @ts-check
/**
 * Admin helper for the running server: create a game or list the magic links.
 *
 *   node scripts/admin.js new-game [--force] [--seed N] [--option id=choice] [--bots Bob,Cat] [Name Name …]
 *   node scripts/admin.js links
 *
 * Environment
 *   BASE          server origin (default http://localhost:8788)
 *   ADMIN_SECRET  only needed if the server is locked; falls back to .dev.vars
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:8788';
const VALUE_FLAGS = ['--seed', '--option', '--bots'];

/** @returns {string | undefined} the host key, if the server needs one */
function readSecret() {
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET;
  try {
    const line = readFileSync('.dev.vars', 'utf8').split('\n').find((entry) => entry.startsWith('ADMIN_SECRET='));
    if (line) return line.slice('ADMIN_SECRET='.length).trim() || undefined;
  } catch {
    // no .dev.vars — the server may simply be open
  }
  return undefined;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const [command = 'links', ...rest] = argv;
  const force = rest.includes('--force');
  /** @type {number | undefined} */
  let seed;
  /** @type {Record<string, string>} */
  const options = {};
  /** @type {string[] | undefined} */
  let bots;
  /** @type {string[]} */
  const players = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!VALUE_FLAGS.includes(arg)) {
      if (!arg.startsWith('--')) players.push(arg);
      continue;
    }
    const value = rest[++i] ?? '';
    if (arg === '--seed') seed = Number(value);
    if (arg === '--bots') bots = value.split(',').map((name) => name.trim()).filter(Boolean);
    if (arg === '--option') {
      const [id, choice] = value.split('=');
      options[id] = choice;
    }
  }
  return { command, force, seed, options, bots, players };
}

/** @param {{ path: string, method?: string, body?: unknown }} request */
async function call(request) {
  const secret = readSecret();
  const response = await fetch(`${BASE}${request.path}`, {
    method: request.method ?? 'GET',
    headers: { ...(secret ? { authorization: `Bearer ${secret}` } : {}), 'content-type': 'application/json' },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return JSON.parse(text);
}

/** @param {{ links: { player: string, url: string }[], seed?: number, options?: Record<string, string>, bots?: string[] }} result */
function printLinks(result) {
  if (result.seed !== undefined) console.log(`seed ${result.seed} · options ${JSON.stringify(result.options ?? {})}\n`);
  for (const link of result.links) console.log(`${link.player.padEnd(20)} ${link.url}${result.bots?.includes(link.player) ? '   (bot)' : ''}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'new-game') {
    const body = {
      force: args.force,
      options: args.options,
      ...(args.seed !== undefined ? { seed: args.seed } : {}),
      ...(args.bots !== undefined ? { bots: args.bots } : {}),
      ...(args.players.length ? { players: args.players } : {}),
    };
    return printLinks(await call({ path: '/admin/new-game', method: 'POST', body }));
  }
  if (args.command === 'links') return printLinks(await call({ path: '/admin/links' }));
  throw new Error(`unknown command: ${args.command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
