/* -------------------------------------------------------
 * scripts/electron-dev.js
 *
 * All-in-one dev script for Windows compatibility.
 * Picks a free port, pins Vite to it, waits for it to be
 * ready, then launches Electron pointed at that exact port.
 * Kills both on exit.
 *
 * Why the free-port dance: if 5173 is already taken (an
 * orphaned dev server, another project), Vite silently moves
 * to 5174/5175… while a hardcoded loader still opens 5173 —
 * which serves a *different* server. When that server later
 * dies, Electron shows a blank window. Choosing the port here
 * and passing it to Electron via VITE_DEV_SERVER_URL keeps the
 * launcher, Vite, and Electron in agreement.
 * ------------------------------------------------------- */

const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

const PREFERRED_PORT = 5173;
const MAX_RETRIES = 60;
const RETRY_INTERVAL = 500;

let viteProcess = null;
let electronProcess = null;
let devUrl = null;

/* ── Find a free port, starting at `start` and counting up. ── */
function findFreePort(start, attemptsLeft = 25) {
  return new Promise((resolve, reject) => {
    const tryPort = (port, left) => {
      const srv = net.createServer();
      srv.once('error', () => {
        if (left <= 0) return reject(new Error('No free port found near ' + start));
        tryPort(port + 1, left - 1);
      });
      srv.once('listening', () => srv.close(() => resolve(port)));
      srv.listen(port, '127.0.0.1');
    };
    tryPort(start, attemptsLeft);
  });
}

/* ── 1. Choose a port and start Vite pinned to it. ── */
async function start() {
  const port = await findFreePort(PREFERRED_PORT);
  devUrl = `http://localhost:${port}`;
  console.log(`[dev] Starting Vite dev server on ${devUrl} ...`);

  const npxPath = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // --strictPort makes Vite fail loudly instead of silently drifting to another
  // port; since we already picked a free one, it should bind cleanly.
  viteProcess = spawn(npxPath, ['vite', '--port', String(port), '--strictPort'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
  });

  viteProcess.on('error', (err) => {
    console.error('[dev] Failed to start Vite:', err.message);
    process.exit(1);
  });

  viteProcess.on('exit', (code) => {
    console.log(`[dev] Vite exited (code ${code})`);
    cleanup();
  });

  setTimeout(() => checkVite(), 1000);
}

/* ── 2. Wait for Vite (on the chosen port), then launch Electron. ── */
function checkVite(retries = 0) {
  if (retries >= MAX_RETRIES) {
    console.error('[dev] Vite did not start within 30s. Aborting.');
    cleanup();
    return;
  }

  const req = http.get(devUrl, (res) => {
    res.resume();
    console.log('[dev] Vite is ready. Launching Electron...');
    launchElectron();
  });

  req.on('error', () => {
    setTimeout(() => checkVite(retries + 1), RETRY_INTERVAL);
  });

  req.setTimeout(1000, () => {
    req.destroy();
    setTimeout(() => checkVite(retries + 1), RETRY_INTERVAL);
  });
}

function launchElectron() {
  const electronPath = require('electron');

  // --no-backend: leave port 8080 alone so a backend run from source can own it.
  // Without this the app claims the port on startup and `mvn spring-boot:run`
  // fails until the app is closed.
  const noBackend = process.argv.includes('--no-backend');
  if (noBackend) {
    console.log('[dev] --no-backend: the app will not start a backend; run one yourself on 8080.');
  }

  electronProcess = spawn(electronPath.toString(), ['.'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    // Tell Electron exactly which URL to load — no port guessing.
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VITE_DEV_SERVER_URL: devUrl,
      ...(noBackend ? { CAUSIFY_NO_BACKEND: '1' } : {}),
    },
  });

  electronProcess.on('error', (err) => {
    console.error('[dev] Failed to start Electron:', err.message);
  });

  electronProcess.on('exit', () => {
    console.log('[dev] Electron closed. Shutting down...');
    cleanup();
  });
}

/* ── 3. Cleanup ── */
function cleanup() {
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill();
  }
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

start().catch((err) => {
  console.error('[dev]', err.message);
  process.exit(1);
});
