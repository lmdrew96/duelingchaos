import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as http from 'http';
import * as path from 'path';

const PROJECT_ROOT = path.join(__dirname, '..');
const FORGE_DIR = path.join(PROJECT_ROOT, 'vendor', 'forge');
const FORGE_JAR = path.join(FORGE_DIR, 'forge-gui-desktop-2.0.13-jar-with-dependencies.jar');
const SHIM_BUILD_DIR = path.join(PROJECT_ROOT, 'bridge-shim', 'build');
const DECKS_DIR = path.join(PROJECT_ROOT, 'decks');

const JAVA_PORT = 8787;
const HTTP_PORT = Number(process.env.PORT) || 4310;

// Phase 1/2 spike decks — hardcoded until the deckbuilder patch lands.
// Seat 1 (human, driven over HTTP) vs seat 2 (AI).
const DECK1 = 'res/quest/precons/Gruul Goliaths.dck';
const DECK2 = 'res/quest/precons/Symbiotic Swarm.dck';

function startForgeShim(): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolve, reject) => {
    const classpath = `${FORGE_JAR}:${SHIM_BUILD_DIR}`;
    const child = spawn(
      'java',
      ['-cp', classpath, 'dev.duelingchaos.bridge.BridgeMain', DECK1, DECK2, String(JAVA_PORT), DECKS_DIR],
      { cwd: FORGE_DIR },
    );

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

async function main(): Promise<void> {
  const forgeProcess = await startForgeShim();
  console.log('Forge shim ready.');

  const server = http.createServer((req, res) => {
    if (req.url === '/api/game-state' && req.method === 'GET') {
      proxyToShim(req, res, '/state', 'GET');
      return;
    }
    // Every other bridge endpoint (actions, card search, formats, decks,
    // legality) mirrors its shim path 1:1 under /api — just strip the
    // prefix and forward.
    if (req.url?.startsWith('/api/') && (req.method === 'GET' || req.method === 'POST')) {
      const shimPath = req.url.slice('/api'.length);
      proxyToShim(req, res, shimPath, req.method);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('error', (err) => {
    console.error('Bridge server error:', err);
    forgeProcess.kill();
    process.exit(1);
  });

  server.listen(HTTP_PORT, () => {
    console.log(`Bridge listening on http://localhost:${HTTP_PORT}`);
  });

  const shutdown = (): void => {
    server.close();
    forgeProcess.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
