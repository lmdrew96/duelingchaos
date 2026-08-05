import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as http from 'http';
import * as path from 'path';

const PROJECT_ROOT = path.join(__dirname, '..');
const FORGE_DIR = path.join(PROJECT_ROOT, 'vendor', 'forge');
const FORGE_JAR = path.join(FORGE_DIR, 'forge-gui-desktop-2.0.13-jar-with-dependencies.jar');
const SHIM_BUILD_DIR = path.join(PROJECT_ROOT, 'bridge-shim', 'build');

const JAVA_PORT = 8787;
const HTTP_PORT = Number(process.env.PORT) || 4310;

// Phase 1 spike decks — hardcoded until the deckbuilder patch lands.
const DECK1 = 'res/quest/precons/Gruul Goliaths.dck';
const DECK2 = 'res/quest/precons/Symbiotic Swarm.dck';

function startForgeShim(): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolve, reject) => {
    const classpath = `${FORGE_JAR}:${SHIM_BUILD_DIR}`;
    const child = spawn(
      'java',
      ['-cp', classpath, 'dev.duelingchaos.bridge.BridgeMain', DECK1, DECK2, String(JAVA_PORT)],
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

async function main(): Promise<void> {
  const forgeProcess = await startForgeShim();
  console.log('Forge shim ready.');

  const server = http.createServer((req, res) => {
    if (req.url === '/api/game-state' && req.method === 'GET') {
      fetch(`http://127.0.0.1:${JAVA_PORT}/state`)
        .then((upstream) => upstream.text())
        .then((body) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forge shim unreachable' }));
        });
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
