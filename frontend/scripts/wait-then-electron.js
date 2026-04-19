/* -------------------------------------------------------
 * scripts/wait-then-electron.js
 *
 * Waits for Vite dev server to be ready on port 5173,
 * then launches Electron. Used by the "electron:dev" script.
 * ------------------------------------------------------- */

const http = require('http');
const { spawn } = require('child_process');

const VITE_URL = 'http://localhost:5173';
const MAX_RETRIES = 60;
const RETRY_INTERVAL = 500;

function checkVite(retries = 0) {
  if (retries >= MAX_RETRIES) {
    console.error('[wait-then-electron] Vite did not start within 30s. Aborting.');
    process.exit(1);
  }

  const req = http.get(VITE_URL, (res) => {
    res.resume();
    console.log('[wait-then-electron] Vite is ready. Launching Electron...');
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
  const child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });

  child.on('close', (code) => {
    process.exit(code);
  });
}

console.log('[wait-then-electron] Waiting for Vite dev server...');
checkVite();
