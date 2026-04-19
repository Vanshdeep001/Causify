/* -------------------------------------------------------
 * scripts/electron-dev.js
 *
 * All-in-one dev script for Windows compatibility.
 * Spawns Vite dev server, waits for it to be ready,
 * then launches Electron. Kills both on exit.
 * ------------------------------------------------------- */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const VITE_URL = 'http://localhost:5173';
const MAX_RETRIES = 60;
const RETRY_INTERVAL = 500;

let viteProcess = null;
let electronProcess = null;

/* ── 1. Start Vite ── */
console.log('[dev] Starting Vite dev server...');

const npxPath = process.platform === 'win32' ? 'npx.cmd' : 'npx';
viteProcess = spawn(npxPath, ['vite'], {
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

/* ── 2. Wait for Vite, then launch Electron ── */
function checkVite(retries = 0) {
  if (retries >= MAX_RETRIES) {
    console.error('[dev] Vite did not start within 30s. Aborting.');
    cleanup();
    return;
  }

  const req = http.get(VITE_URL, (res) => {
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
  electronProcess = spawn(electronPath.toString(), ['.'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
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

// Start polling for Vite
setTimeout(() => checkVite(), 1000);
