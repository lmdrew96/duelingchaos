import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { getUserId } from './auth';
import {
  deleteDeck,
  getMatchStats,
  getSavedDeck,
  listSavedDeckFormats,
  recordMatchResult,
  saveDeck,
  StoredDeckCard,
} from './db';

const PROJECT_ROOT = path.join(__dirname, '..');

// Optional — CLERK_SECRET_KEY/DATABASE_URL only matter for saved decks
// (see src/auth.ts, src/db.ts); the game itself runs fine without a .env.
const ENV_FILE = path.join(PROJECT_ROOT, '.env');
if (fs.existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}

const FORGE_DIR = path.join(PROJECT_ROOT, 'vendor', 'forge');
const FORGE_JAR = path.join(FORGE_DIR, 'forge-gui-desktop-2.0.13-jar-with-dependencies.jar');
const SHIM_BUILD_DIR = path.join(PROJECT_ROOT, 'bridge-shim', 'build');
const DECKS_DIR = path.join(PROJECT_ROOT, 'decks');
// Curated preset library — tracked in the repo, unlike vendor/forge's own
// ~500-deck res/quest/precons (that whole tree is gitignored, a per-machine
// local install; see DeckboxHandlers.java).
const PRESETS_DIR = path.join(PROJECT_ROOT, 'res', 'presets');

const JAVA_PORT = 8787;
const HTTP_PORT = Number(process.env.PORT) || 4310;

// Forge's bundled AI personality profiles — res/ai/*.ai on disk, passed
// straight through to GamePlayerUtil.createAiPlayer(name, profile) in
// BridgeMain. No bridge endpoint enumerates these; the set is small and
// fixed, so it's just hardcoded here and in the frontend's picker.
const AI_PROFILES = ['Cautious', 'Default', 'Experimental', 'Reckless'];

// Phase 1/2 spike decks — default boot pairing, also the fixed AI opponent
// for a match started from a saved deck (see startMatch).
const DECK1 = 'res/quest/precons/Gruul Goliaths.dck';
const DECK2 = 'res/quest/precons/Symbiotic Swarm.dck';

// Reassigned by restartMatch() when a match is started from a saved deck —
// the running Java process is killed and a fresh one spawned with the
// chosen deck, reusing the same JAVA_PORT.
let forgeProcess: ChildProcessWithoutNullStreams | null = null;

// Tracks the deck/user behind the currently-running match so game-over can
// be recorded exactly once (see handleMatchReport). Null for the default
// boot pairing, which isn't tied to a saved deck or a signed-in user.
let currentMatch: { userId: string; deckName: string; reported: boolean } | null = null;

function startForgeShim(deck1: string, deck2: string, aiProfile?: string): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolve, reject) => {
    const classpath = `${FORGE_JAR}:${SHIM_BUILD_DIR}`;
    const args = ['-cp', classpath, 'dev.duelingchaos.bridge.BridgeMain', deck1, deck2, String(JAVA_PORT), PRESETS_DIR];
    if (aiProfile) args.push(aiProfile);
    const child = spawn('java', args, { cwd: FORGE_DIR });

    let resolved = false;
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(`[forge] ${text}`);
      if (!resolved && text.includes('BRIDGE_READY')) {
        resolved = true;
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(`[forge] ${chunk.toString()}`);
    });
    child.on('exit', (code) => {
      if (!resolved) {
        reject(new Error(`Forge shim exited before becoming ready (code ${code})`));
      }
    });
  });
}

// Kills the running shim and waits for the OS to actually release JAVA_PORT
// before spawning the replacement — starting the new process too early would
// race the old one for the port. Any in-flight request during this window
// gets the existing "Forge shim unreachable" 502 from proxyToShim, which the
// board already renders as a retry-able error.
async function restartMatch(deck1: string, deck2: string, aiProfile?: string): Promise<void> {
  if (forgeProcess) {
    const dying = forgeProcess;
    await new Promise<void>((resolve) => {
      dying.once('exit', () => resolve());
      dying.kill();
    });
  }
  forgeProcess = await startForgeShim(deck1, deck2, aiProfile);
}

// Forge has no classes reachable from Node to serialize a real .dck file, so
// a saved deck's cards go out as a plain "N Card Name" decklist instead —
// BridgeMain.loadDeck() recognizes the .decklist.txt extension and parses it
// with the same CardPool.fromCardList Forge already uses for pasted
// decklists. Single fixed filename: only one match runs at a time, so each
// new match just overwrites the last one's file.
const HUMAN_DECKLIST_PATH = path.join(DECKS_DIR, 'tmp-match.decklist.txt');

// Sideboard cards are deliberately not part of the deck being played, so
// they're dropped here — Forge's CardPool.fromCardList (which parses this
// file) only ever sees Main/Commander cards, as plain "N Name" lines with no
// section marker.
function writeHumanDecklist(cards: StoredDeckCard[]): string {
  if (!fs.existsSync(DECKS_DIR)) {
    fs.mkdirSync(DECKS_DIR, { recursive: true });
  }
  const text = cards
    .filter((c) => c.section !== 'sideboard')
    .map((c) => `${c.count} ${c.name}`)
    .join('\n');
  fs.writeFileSync(HUMAN_DECKLIST_PATH, text);
  return HUMAN_DECKLIST_PATH;
}

function proxyToShim(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  shimPath: string,
  method: string,
): void {
  const forward = async (): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = method === 'POST' ? Buffer.concat(chunks) : undefined;
    const contentType = req.headers['content-type'] ?? 'application/json';

    const upstream = await fetch(`http://127.0.0.1:${JAVA_PORT}${shimPath}`, {
      method,
      headers: method === 'POST' ? { 'Content-Type': contentType } : undefined,
      body,
    });
    const responseBody = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(responseBody);
  };

  forward().catch(() => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forge shim unreachable' }));
  });
}

function respondJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function fetchShimJson(shimPath: string): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${JAVA_PORT}${shimPath}`);
  return res.json();
}

// Forge's own CardPool.fromCardList format, "<count> <card name>" per
// non-empty line — matches what api.ts's toDecklistText already sends, and
// what DeckSerializer used to parse before saved decks moved to Postgres.
// A trailing " {CMDR}"/" {SB}" marker (also written by toDecklistText)
// records a card's commander/side-deck assignment.
function parseDecklistText(body: string): StoredDeckCard[] {
  const cards: StoredDeckCard[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^(\d+)\s+(.+?)(?:\s+\{(CMDR|SB)\})?$/.exec(line);
    if (!match) continue;
    const count = Number(match[1]);
    const name = match[2].trim();
    if (!name || count <= 0) continue;
    const section = match[3] === 'CMDR' ? 'commander' : match[3] === 'SB' ? 'sideboard' : undefined;
    cards.push(section ? { name, count, section } : { name, count });
  }
  return cards;
}

function toDeckSummaryJson(
  name: string,
  cards: StoredDeckCard[],
  format?: string,
): { name: string; deckSize: number; cards: StoredDeckCard[]; format?: string } {
  return { name, deckSize: cards.reduce((sum, c) => sum + c.count, 0), cards, format };
}

// Saved decks are the only thing gated behind Clerk sign-in (see the "Auth
// and DB" ChaosPatch scoping decision) — presets, card search, and the
// game engine itself all stay open to anyone hitting the bridge locally.
async function handleDecksList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const presetsResult = (await fetchShimJson('/decks/list')) as {
    presets: string[];
    presetFormats: Record<string, string[]>;
  };
  const userId = await getUserId(req);
  const savedWithFormat = userId ? await listSavedDeckFormats(userId) : [];
  const saved = savedWithFormat.map((d) => d.name);
  const savedFormats: Record<string, string> = {};
  for (const d of savedWithFormat) savedFormats[d.name] = d.format;
  respondJson(res, 200, { presets: presetsResult.presets, saved, presetFormats: presetsResult.presetFormats, savedFormats });
}

async function handleDeckGet(req: http.IncomingMessage, res: http.ServerResponse, shimPath: string): Promise<void> {
  const url = new URL(shimPath, 'http://internal');
  const source = url.searchParams.get('source') ?? 'saved';
  const name = url.searchParams.get('name');
  if (!name) {
    respondJson(res, 400, { error: 'missing name' });
    return;
  }
  if (source === 'preset') {
    proxyToShim(req, res, shimPath, 'GET');
    return;
  }
  const userId = await getUserId(req);
  if (!userId) {
    respondJson(res, 401, { error: 'sign in required to load a saved deck' });
    return;
  }
  const deck = await getSavedDeck(userId, name);
  if (!deck) {
    respondJson(res, 404, { error: 'deck not found' });
    return;
  }
  respondJson(res, 200, toDeckSummaryJson(deck.name, deck.cards, deck.format));
}

async function handleDeckSave(req: http.IncomingMessage, res: http.ServerResponse, shimPath: string): Promise<void> {
  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'POST only' });
    return;
  }
  const userId = await getUserId(req);
  if (!userId) {
    respondJson(res, 401, { error: 'sign in required to save a deck' });
    return;
  }
  const url = new URL(shimPath, 'http://internal');
  const name = url.searchParams.get('name');
  if (!name || name.length > 100) {
    respondJson(res, 400, { error: 'missing or invalid name' });
    return;
  }
  const format = url.searchParams.get('format') || 'Standard';
  const body = await readRequestBody(req);
  const cards = parseDecklistText(body);
  if (cards.length === 0) {
    respondJson(res, 400, { error: 'empty or unparseable decklist' });
    return;
  }
  await saveDeck(userId, name, cards, format);
  respondJson(res, 200, toDeckSummaryJson(name, cards, format));
}

async function handleDeckDelete(req: http.IncomingMessage, res: http.ServerResponse, shimPath: string): Promise<void> {
  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'POST only' });
    return;
  }
  const userId = await getUserId(req);
  if (!userId) {
    respondJson(res, 401, { error: 'sign in required to delete a saved deck' });
    return;
  }
  const url = new URL(shimPath, 'http://internal');
  const name = url.searchParams.get('name');
  if (!name) {
    respondJson(res, 400, { error: 'missing name' });
    return;
  }
  const deleted = await deleteDeck(userId, name);
  respondJson(res, 200, { deleted });
}

// Preset AI decks live as .dck files under PRESETS_DIR (see
// DeckboxHandlers.preconDir); /decks/list already reports their names. This
// resolves a player's opponent choice from handleMatchStart into a concrete
// .dck path the shim can boot with — 'random'/undefined picks one of the
// current presets uniformly at random, restricted to presets legal in the
// player's deck format when any such preset exists (falls back to the full
// pool only if none match, mirroring the hint text in PlayGate). An
// absolute path, since BridgeMain runs with cwd=FORGE_DIR while
// PRESETS_DIR lives at the project root.
async function resolveOpponentDeckPath(preferredName: string | undefined, playerFormat: string): Promise<string> {
  const { presets, presetFormats } = (await fetchShimJson('/decks/list')) as {
    presets: string[];
    presetFormats: Record<string, string[]>;
  };
  if (presets.length === 0) {
    return DECK2;
  }
  let name = preferredName;
  if (!name || name === 'random') {
    const formatLegal = presets.filter((p) => presetFormats[p]?.includes(playerFormat));
    const pool = formatLegal.length > 0 ? formatLegal : presets;
    name = pool[Math.floor(Math.random() * pool.length)];
  } else if (!presets.includes(name)) {
    throw new Error(`unknown opponent deck: ${name}`);
  }
  return path.join(PRESETS_DIR, `${name}.dck`);
}

// Starts a new match against a chosen AI opponent using a signed-in user's
// saved deck — restarts the single Java shim process with that deck instead
// of the boot-time hardcoded pairing (see the "Start a match from a saved
// deck" ChaosPatch scoping decision, later extended to add opponent deck
// selection).
async function handleMatchStart(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'POST only' });
    return;
  }
  const userId = await getUserId(req);
  if (!userId) {
    respondJson(res, 401, { error: 'sign in required to start a match' });
    return;
  }
  const body = await readRequestBody(req);
  let deckName: string | undefined;
  let opponentDeck: string | undefined;
  let aiProfile: string | undefined;
  try {
    const parsed = JSON.parse(body) as { deckName?: string; opponentDeck?: string; aiProfile?: string };
    deckName = parsed.deckName;
    opponentDeck = parsed.opponentDeck;
    aiProfile = parsed.aiProfile;
  } catch {
    respondJson(res, 400, { error: 'invalid JSON body' });
    return;
  }
  if (!deckName) {
    respondJson(res, 400, { error: 'missing deckName' });
    return;
  }
  if (aiProfile && !AI_PROFILES.includes(aiProfile)) {
    respondJson(res, 400, { error: `unknown aiProfile: ${aiProfile}` });
    return;
  }
  const deck = await getSavedDeck(userId, deckName);
  if (!deck) {
    respondJson(res, 404, { error: 'deck not found' });
    return;
  }
  let opponentDeckPath: string;
  try {
    opponentDeckPath = await resolveOpponentDeckPath(opponentDeck, deck.format);
  } catch (err) {
    respondJson(res, 400, { error: (err as Error).message });
    return;
  }
  const humanDeckPath = writeHumanDecklist(deck.cards);
  await restartMatch(humanDeckPath, opponentDeckPath, aiProfile);
  currentMatch = { userId, deckName, reported: false };
  respondJson(res, 200, { ok: true });
}

// Fired once by the frontend when it observes gameOver in the polled game
// state (same "confirm from the client" pattern as concede) — records
// against whatever match is currently tracked, or no-ops if the running game
// isn't tied to a saved deck (the boot-time default pairing) or was already
// reported.
async function handleMatchReport(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'POST only' });
    return;
  }
  if (!currentMatch || currentMatch.reported) {
    respondJson(res, 200, { recorded: false });
    return;
  }
  const body = await readRequestBody(req);
  let won: boolean, isDraw: boolean, conceded: boolean;
  try {
    ({ won, isDraw, conceded } = JSON.parse(body) as { won: boolean; isDraw: boolean; conceded: boolean });
  } catch {
    respondJson(res, 400, { error: 'invalid JSON body' });
    return;
  }
  currentMatch.reported = true;
  await recordMatchResult(currentMatch.userId, currentMatch.deckName, won, isDraw, conceded);
  respondJson(res, 200, { recorded: true });
}

async function handleMatchStats(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const userId = await getUserId(req);
  if (!userId) {
    respondJson(res, 401, { error: 'sign in required' });
    return;
  }
  const stats = await getMatchStats(userId);
  respondJson(res, 200, stats);
}

async function main(): Promise<void> {
  forgeProcess = await startForgeShim(DECK1, DECK2);
  console.log('Forge shim ready.');

  const server = http.createServer((req, res) => {
    if (req.url === '/api/game-state' && req.method === 'GET') {
      proxyToShim(req, res, '/state', 'GET');
      return;
    }
    if (req.url?.startsWith('/api/') && (req.method === 'GET' || req.method === 'POST')) {
      const shimPath = req.url.slice('/api'.length);
      const shimRoute = shimPath.split('?')[0];

      // Saved decks are Clerk+Postgres-backed now (see src/db.ts, src/auth.ts)
      // — everything else on the shim (presets, card search, formats,
      // legality, live-game actions) still mirrors 1:1 under /api.
      if (shimRoute === '/decks/list' && req.method === 'GET') {
        handleDecksList(req, res).catch(() => respondJson(res, 502, { error: 'Forge shim unreachable' }));
        return;
      }
      if (shimRoute === '/decks/get' && req.method === 'GET') {
        handleDeckGet(req, res, shimPath).catch(() => respondJson(res, 502, { error: 'Forge shim unreachable' }));
        return;
      }
      if (shimRoute === '/decks/save' && req.method === 'POST') {
        handleDeckSave(req, res, shimPath).catch((err) => {
          console.error('deck save failed:', err);
          respondJson(res, 500, { error: 'failed to save deck' });
        });
        return;
      }
      if (shimRoute === '/decks/delete' && req.method === 'POST') {
        handleDeckDelete(req, res, shimPath).catch((err) => {
          console.error('deck delete failed:', err);
          respondJson(res, 500, { error: 'failed to delete deck' });
        });
        return;
      }
      if (shimRoute === '/match/start' && req.method === 'POST') {
        handleMatchStart(req, res).catch((err) => {
          console.error('match start failed:', err);
          respondJson(res, 500, { error: 'failed to start match' });
        });
        return;
      }
      if (shimRoute === '/match/report' && req.method === 'POST') {
        handleMatchReport(req, res).catch((err) => {
          console.error('match report failed:', err);
          respondJson(res, 500, { error: 'failed to record match result' });
        });
        return;
      }
      if (shimRoute === '/match/stats' && req.method === 'GET') {
        handleMatchStats(req, res).catch((err) => {
          console.error('match stats failed:', err);
          respondJson(res, 500, { error: 'failed to load match stats' });
        });
        return;
      }

      proxyToShim(req, res, shimPath, req.method);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('error', (err) => {
    console.error('Bridge server error:', err);
    forgeProcess?.kill();
    process.exit(1);
  });

  server.listen(HTTP_PORT, () => {
    console.log(`Bridge listening on http://localhost:${HTTP_PORT}`);
  });

  const shutdown = (): void => {
    server.close();
    forgeProcess?.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
