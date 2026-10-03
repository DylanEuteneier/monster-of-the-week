/**
 * Monster of the Week — Cloudflare Worker + the single "the-game" Durable Object.
 *
 * Routes
 *   GET  /p/<token>          the table UI (index.html); the token is the player's identity
 *   GET  /ws/<token>         websocket upgrade, handled by the Durable Object
 *   GET  /host               the host page (host.html): deal games, copy links
 *   GET  /hotseat            the table UI, playing every human seat from one tab
 *   GET  /assets             the assets page (assets.html): every sprite and the palette
 *   GET  /assets/…           sprite files and sprites.json, served straight from public/assets/
 *   POST /admin/new-game     { players?, seed?, force?, options?: Record<string,string>, bots?: string[] }  → magic links
 *   GET  /admin/links        re-list the magic links for the current game
 *   GET  /admin/status       phase, round, options, and seats of the current game
 *   *                        static assets from public/
 *
 * Seats keep their tokens across games when the player names are unchanged, so
 * a host can deal a fresh game and everyone's link keeps working.
 *
 * Admin routes are open by default; set ADMIN_SECRET to require a bearer token.
 * Hidden information never leaves the Durable Object: every client receives only
 * its own playerView.
 */
import { DurableObject } from 'cloudflare:workers';
import { applyMove, createGame, playerView, IllegalMoveError, spec } from '../public/engine.js';
import { botMove } from '../public/bots.js';
import type { GameState, Move, Options, PlayerView } from '../public/engine.js';

export interface Env {
  GAME: DurableObjectNamespace<Game>;
  ASSETS: Fetcher;
  ADMIN_SECRET?: string;
}

type TokenMap = Record<string, string>; // token → playerId

interface ChatLine {
  from: string;
  text: string;
  at: number;
}

type ClientMessage =
  | { type: 'move'; move: Move }
  | { type: 'chat'; text: string };

type ServerMessage =
  | { type: 'state'; view: PlayerView; online: string[]; bots: string[] }
  | { type: 'error'; reason: string }
  | { type: 'chat'; lines: ChatLine[]; reset?: boolean }
  | { type: 'presence'; online: string[] };

interface NewGameRequest {
  players?: unknown;
  seed?: unknown;
  force?: unknown;
  options?: unknown;
  bots?: unknown;
}

const GAME_NAME = 'the-game';
const STORAGE_GAME = 'game';
const STORAGE_TOKENS = 'tokens';
const STORAGE_CHAT = 'chat';
const STORAGE_BOTS = 'bots';
const MAX_BOT_MOVES_PER_TICK = 60;
const CHAT_HISTORY = 100;
const CHAT_MAX_CHARS = 280;
const PLAYER_NAME_MAX_CHARS = 20;
const RATE_LIMIT = { burst: 20, perSecond: 4 };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json' } });
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.byteLength !== right.byteLength) return false;
  return crypto.subtle.timingSafeEqual(left, right);
}

/**
 * Host routes are open unless ADMIN_SECRET is configured; set it (wrangler
 * secret put ADMIN_SECRET) to require `Authorization: Bearer <secret>`.
 */
function isAuthorised(request: Request, env: Env): Response | null {
  if (!env.ADMIN_SECRET) return null;
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!constantTimeEqual(presented, env.ADMIN_SECRET)) return json({ error: 'unauthorised' }, 401);
  return null;
}

function defaultPlayerNames(): string[] {
  return Array.from({ length: spec.meta.players.tunedFor }, (_, i) => `Seat ${i + 1}`);
}

function parsePlayerNames(raw: unknown): string[] {
  if (raw === undefined) return defaultPlayerNames();
  if (!Array.isArray(raw)) throw new Error('players must be an array of names');
  const names = raw.map((name) => (typeof name === 'string' ? name.trim() : ''));
  if (names.some((name) => name.length === 0 || name.length > PLAYER_NAME_MAX_CHARS)) {
    throw new Error(`each player name must be 1–${PLAYER_NAME_MAX_CHARS} characters`);
  }
  return names;
}

/** Shape only; the engine checks each option against the variants in spec.json. */
function parseOptions(raw: unknown): Partial<Options> | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.values(raw).some((value) => typeof value !== 'string')) {
    throw new Error('options must be an object of variant id → choice id');
  }
  return raw as Partial<Options>;
}

function parseBots(raw: unknown, players: string[]): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((name) => typeof name !== 'string')) throw new Error('bots must be an array of seat names');
  const bots = raw.filter((name): name is string => players.includes(name));
  if (bots.length >= players.length) throw new Error('at least one seat must be human');
  return [...new Set(bots)];
}

function parseSeed(raw: unknown): number {
  if (raw === undefined) return Math.floor(Math.random() * 2 ** 31);
  if (typeof raw !== 'number' || !Number.isInteger(raw)) throw new Error('seed must be an integer');
  return raw;
}

/** Simple token bucket per socket so a stuck client cannot spin the object. */
class RateLimiter {
  private buckets = new WeakMap<WebSocket, { tokens: number; last: number }>();

  allow(ws: WebSocket): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(ws) ?? { tokens: RATE_LIMIT.burst, last: now };
    bucket.tokens = Math.min(RATE_LIMIT.burst, bucket.tokens + ((now - bucket.last) / 1000) * RATE_LIMIT.perSecond);
    bucket.last = now;
    this.buckets.set(ws, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}

// ---------------------------------------------------------------------------
// The Durable Object
// ---------------------------------------------------------------------------

export class Game extends DurableObject<Env> {
  private game: GameState | null | undefined;
  private tokens: TokenMap | undefined;
  private chat: ChatLine[] | undefined;
  private bots: string[] | undefined;
  private limiter = new RateLimiter();

  // Hibernation drops in-memory fields between messages; reload lazily on every wake.
  private async load(): Promise<void> {
    if (this.game !== undefined && this.tokens !== undefined && this.chat !== undefined && this.bots !== undefined) return;
    const [game, tokens, chat, bots] = await Promise.all([
      this.ctx.storage.get<GameState>(STORAGE_GAME),
      this.ctx.storage.get<TokenMap>(STORAGE_TOKENS),
      this.ctx.storage.get<ChatLine[]>(STORAGE_CHAT),
      this.ctx.storage.get<string[]>(STORAGE_BOTS),
    ]);
    this.game = game ?? null;
    this.tokens = tokens ?? {};
    this.chat = chat ?? [];
    this.bots = bots ?? [];
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);
    if (url.pathname.startsWith('/ws/')) return this.acceptPlayer(request, url.pathname.slice('/ws/'.length));
    if (url.pathname === '/admin/new-game' && request.method === 'POST') return this.newGame(request);
    if (url.pathname === '/admin/links' && request.method === 'GET') return this.listLinks(request);
    if (url.pathname === '/admin/status' && request.method === 'GET') return this.status(request);
    return json({ error: 'not found' }, 404);
  }

  // --- admin ---------------------------------------------------------------

  private async newGame(request: Request): Promise<Response> {
    const denied = isAuthorised(request, this.env);
    if (denied) return denied;
    let body: NewGameRequest = {};
    try {
      body = request.headers.get('content-type')?.includes('application/json') ? await request.json<NewGameRequest>() : {};
      if (this.game && this.game.phase !== 'ended' && body.force !== true) {
        return json({ error: 'a game is in progress; pass { "force": true } to replace it' }, 409);
      }
      const players = parsePlayerNames(body.players);
      const seed = parseSeed(body.seed);
      const game = createGame({ seed, players, options: parseOptions(body.options) });
      await this.replaceGame({ game, tokens: this.tokensFor(players), bots: parseBots(body.bots, players) });
      return json({ seed, options: game.options, bots: this.bots, links: this.links(new URL(request.url)) }, 201);
    } catch (error) {
      if (error instanceof Error) return json({ error: error.message }, 400);
      throw error;
    }
  }

  /** Existing seats keep their tokens; new names get fresh ones. */
  private tokensFor(playerIds: string[]): TokenMap {
    const existing = new Map(Object.entries(this.tokens ?? {}).map(([token, player]) => [player, token]));
    return Object.fromEntries(playerIds.map((id) => [existing.get(id) ?? randomToken(), id]));
  }

  private async replaceGame(next: { game: GameState; tokens: TokenMap; bots: string[] }): Promise<void> {
    this.game = next.game;
    this.tokens = next.tokens;
    this.chat = [];
    this.bots = next.bots;
    await this.ctx.storage.put({ [STORAGE_GAME]: next.game, [STORAGE_TOKENS]: next.tokens, [STORAGE_CHAT]: [], [STORAGE_BOTS]: next.bots });
    await this.runBots();
    // Seats that survived the redeal flip straight to round 1; anyone else is cut loose.
    for (const ws of this.ctx.getWebSockets()) {
      const playerId = this.playerOf(ws);
      if (!playerId || !next.game.players[playerId]) ws.close(4000, 'a new game was dealt without your seat');
    }
    for (const ws of this.ctx.getWebSockets()) this.send(ws, { type: 'chat', lines: [], reset: true });
    this.broadcastState();
    console.log('New game created. Magic links:', JSON.stringify(this.links(null)));
  }

  private status(request: Request): Response {
    const denied = isAuthorised(request, this.env);
    if (denied) return denied;
    if (!this.game) return json({ hasGame: false });
    const online = this.online();
    return json({
      hasGame: true,
      options: this.game.options,
      phase: this.game.phase,
      round: this.game.round,
      bots: this.bots ?? [],
      players: this.game.seating.map((id) => ({ id, online: online.includes(id), bot: this.bots?.includes(id) ?? false })),
    });
  }

  private listLinks(request: Request): Response {
    const denied = isAuthorised(request, this.env);
    if (denied) return denied;
    if (!this.game) return json({ error: 'no game exists yet' }, 404);
    return json({ links: this.links(new URL(request.url)) });
  }

  private links(origin: URL | null): { player: string; url: string }[] {
    const base = origin ? `${origin.protocol}//${origin.host}` : '';
    return Object.entries(this.tokens ?? {}).map(([token, player]) => ({ player, url: `${base}/p/${token}` }));
  }

  // --- websockets ----------------------------------------------------------

  private acceptPlayer(request: Request, token: string): Response {
    if (request.headers.get('upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
    const playerId = this.tokens?.[token];
    if (!playerId || !this.game) return json({ error: 'unknown token or no game in progress' }, 404);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [playerId]);
    server.serializeAttachment({ playerId });
    this.send(server, { type: 'state', view: playerView(this.game, playerId), online: this.online(), bots: this.bots ?? [] });
    this.send(server, { type: 'chat', lines: this.chat ?? [] });
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.load();
    if (!this.limiter.allow(ws)) return this.send(ws, { type: 'error', reason: 'slow down' });
    const playerId = this.playerOf(ws);
    if (!playerId || !this.game) return ws.close(4001, 'no game');
    const message = parseClientMessage(raw);
    if (!message) return this.send(ws, { type: 'error', reason: 'malformed message' });
    if (message.type === 'chat') return this.handleChat(playerId, message.text);
    return this.handleMove(ws, { playerId, move: message.move });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.load();
    ws.close();
    this.broadcastPresence();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.load();
    ws.close(1011, 'socket error');
    this.broadcastPresence();
  }

  private async handleMove(ws: WebSocket, submission: { playerId: string; move: Move }): Promise<void> {
    if (!this.game) return;
    try {
      this.game = applyMove(this.game, submission);
    } catch (error) {
      if (error instanceof IllegalMoveError) return this.send(ws, { type: 'error', reason: error.message });
      throw error;
    }
    // Save, then tell: a crash never shows clients a state that was lost.
    await this.ctx.storage.put(STORAGE_GAME, this.game);
    this.broadcastState();
    await this.runBots();
  }

  /** Let every bot seat act until none can (their turn has passed or they are waiting on a human). */
  private async runBots(): Promise<void> {
    if (!this.game || !this.bots?.length) return;
    let moved = 0;
    for (let tick = 0; tick < MAX_BOT_MOVES_PER_TICK; tick++) {
      const acted = this.bots.some((playerId) => this.tryBotMove(playerId));
      if (!acted) break;
      moved += 1;
    }
    if (moved === 0) return;
    await this.ctx.storage.put(STORAGE_GAME, this.game);
    this.broadcastState();
  }

  private tryBotMove(playerId: string): boolean {
    if (!this.game) return false;
    const move = botMove(this.game, { playerId, rng: Math.random });
    if (!move) return false;
    this.game = applyMove(this.game, { playerId, move });
    return true;
  }

  private async handleChat(playerId: string, text: string): Promise<void> {
    const trimmed = text.trim().slice(0, CHAT_MAX_CHARS);
    if (!trimmed) return;
    const lines = [...(this.chat ?? []), { from: playerId, text: trimmed, at: Date.now() }].slice(-CHAT_HISTORY);
    this.chat = lines;
    await this.ctx.storage.put(STORAGE_CHAT, lines);
    for (const socket of this.ctx.getWebSockets()) this.send(socket, { type: 'chat', lines: lines.slice(-1) });
  }

  private broadcastState(): void {
    if (!this.game) return;
    const online = this.online();
    const bots = this.bots ?? [];
    for (const socket of this.ctx.getWebSockets()) {
      const playerId = this.playerOf(socket);
      if (playerId) this.send(socket, { type: 'state', view: playerView(this.game, playerId), online, bots });
    }
  }

  private broadcastPresence(): void {
    const online = this.online();
    for (const socket of this.ctx.getWebSockets()) this.send(socket, { type: 'presence', online });
  }

  private online(): string[] {
    const ids = this.ctx.getWebSockets().map((socket) => this.playerOf(socket)).filter((id): id is string => id !== null);
    return [...new Set([...ids, ...(this.bots ?? [])])];
  }

  private playerOf(ws: WebSocket): string | null {
    const attachment = ws.deserializeAttachment() as { playerId?: string } | null;
    return attachment?.playerId ?? null;
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // The socket is already closing; the next presence broadcast will drop it.
    }
  }
}

function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as { type?: unknown; move?: unknown; text?: unknown };
  if (candidate.type === 'chat' && typeof candidate.text === 'string') return { type: 'chat', text: candidate.text };
  if (candidate.type === 'move' && typeof candidate.move === 'object' && candidate.move !== null) {
    return { type: 'move', move: candidate.move as Move };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The Worker
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/ws/') || url.pathname.startsWith('/admin/')) {
      return env.GAME.get(env.GAME.idFromName(GAME_NAME)).fetch(request);
    }
    if (url.pathname.startsWith('/p/') || url.pathname === '/hotseat') {
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }
    if (url.pathname === '/host') {
      return env.ASSETS.fetch(new Request(new URL('/host.html', url), request));
    }
    if (url.pathname === '/assets' || url.pathname === '/assets/') {
      return env.ASSETS.fetch(new Request(new URL('/assets.html', url), request));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
