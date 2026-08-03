/* -------------------------------------------------------
 * ipc/tunnel.js — Public reachability for a hosted session
 *
 * A session lives on the owner's machine. On one network that is enough:
 * peers can reach it directly. Across the internet they cannot — a home or
 * office router hands out private addresses and drops unsolicited inbound
 * connections, so there is no address a peer could even be given.
 *
 * cloudflared solves that by reversing the direction. It dials OUT from this
 * machine to Cloudflare and holds the connection open; Cloudflare publishes a
 * public https address and pushes peer traffic back down the line we opened.
 * Outbound is the one thing every router permits, so this works from home
 * wifi, office wifi and mobile hotspots without touching router settings.
 *
 * The binary is bundled (resources/bin) rather than required of the user:
 * the app already asks them to install Java, and a second prerequisite is
 * the kind of setup step people abandon an install over.
 * ------------------------------------------------------- */

const { ipcMain, app } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

/* ── State ── */
let tunnelProcess = null;
let tunnelUrl = null;
let tunnelStatus = 'stopped';   // 'stopped' | 'starting' | 'running' | 'error'
let lastError = null;

/** cloudflared prints the quick-tunnel address inside a banner on stderr. */
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** Giving up is better than a spinner that never resolves. */
const STARTUP_TIMEOUT_MS = 45000;

/**
 * Locate the bundled cloudflared.
 *
 * Packaged builds carry only their own platform's binary (per-platform
 * extraResources), so this is a single fixed location. In development the
 * binaries sit under frontend/resources/bin/<platform>/.
 */
function getBinaryPath() {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', exe);
  }

  const dir = process.platform === 'win32' ? 'win'
    : process.platform === 'darwin' ? 'mac'
      : 'linux';
  return path.join(__dirname, '..', '..', 'resources', 'bin', dir, exe);
}

/**
 * Resolve the binary we will actually run.
 *
 * Prefers the bundled copy. Falls back to one already on PATH so a developer
 * who has cloudflared installed can work before running the fetch script —
 * and so a botched packaging step degrades instead of dead-ending.
 */
function resolveBinary() {
  const bundled = getBinaryPath();
  if (fs.existsSync(bundled)) {
    // extraResources does not reliably preserve the executable bit, and a
    // binary that cannot be executed fails with a bare EACCES.
    if (process.platform !== 'win32') {
      try { fs.chmodSync(bundled, 0o755); } catch { /* best effort */ }
    }
    return bundled;
  }
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

/** Kill the child, forcefully on Windows where SIGTERM is advisory. */
function terminate(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => { });
    } else {
      proc.kill('SIGTERM');
    }
  } catch { /* already gone */ }
}

/**
 * Open a quick tunnel to the local backend.
 *
 * Resolves with the public https URL. Rejects if cloudflared is missing,
 * exits early, or produces no address within the timeout.
 *
 * @param {number} port backend port to expose (8080)
 */
function startTunnel(port = 8080) {
  if (tunnelStatus === 'running' && tunnelUrl) {
    return Promise.resolve({ url: tunnelUrl });
  }
  if (tunnelStatus === 'starting') {
    return Promise.reject(new Error('A tunnel is already starting'));
  }

  const binary = resolveBinary();
  tunnelStatus = 'starting';
  tunnelUrl = null;
  lastError = null;

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err, url) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        tunnelStatus = 'error';
        lastError = err.message;
        terminate(tunnelProcess);
        tunnelProcess = null;
        reject(err);
      } else {
        tunnelStatus = 'running';
        tunnelUrl = url;
        resolve({ url });
      }
    };

    const timer = setTimeout(
      () => finish(new Error('cloudflared did not return an address in time. Check your internet connection.')),
      STARTUP_TIMEOUT_MS
    );

    try {
      tunnelProcess = spawn(binary, [
        'tunnel',
        '--url', `http://127.0.0.1:${port}`,
        // A bundled binary must never try to replace itself: the install
        // directory is usually read-only, and a silent self-update would
        // swap out a file we shipped and signed.
        '--no-autoupdate',
        // Default QUIC needs outbound UDP/7844, which plenty of office and
        // campus networks drop. http2 rides ordinary TCP/443 and connects
        // in the places this feature exists to serve.
        '--protocol', 'http2',
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      finish(new Error(`Could not start cloudflared: ${err.message}`));
      return;
    }

    // The banner carrying the URL goes to stderr, not stdout.
    const scan = (chunk) => {
      const text = chunk.toString();
      const match = text.match(URL_PATTERN);
      if (match) finish(null, match[0]);
    };

    tunnelProcess.stdout?.on('data', scan);
    tunnelProcess.stderr?.on('data', scan);

    tunnelProcess.on('error', (err) => {
      const msg = err.code === 'ENOENT'
        ? 'cloudflared was not found. Run "npm run fetch-cloudflared" to download it.'
        : `cloudflared failed to start: ${err.message}`;
      finish(new Error(msg));
    });

    tunnelProcess.on('exit', (code) => {
      tunnelProcess = null;
      if (!settled) {
        finish(new Error(`cloudflared exited early (code ${code}).`));
        return;
      }
      // Exiting after we handed out a URL means the session is no longer
      // reachable from outside; surface that rather than leaving a dead link.
      tunnelStatus = 'stopped';
      tunnelUrl = null;
    });
  });
}

/** Close the tunnel. Safe to call when nothing is running. */
function stopTunnel() {
  terminate(tunnelProcess);
  tunnelProcess = null;
  tunnelUrl = null;
  tunnelStatus = 'stopped';
  lastError = null;
  return { status: tunnelStatus };
}

function getStatus() {
  return { status: tunnelStatus, url: tunnelUrl, error: lastError };
}

function registerTunnelHandlers() {
  ipcMain.handle('tunnel:start', async (_e, port) => {
    try {
      const { url } = await startTunnel(port || 8080);
      return { ok: true, url };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('tunnel:stop', () => stopTunnel());
  ipcMain.handle('tunnel:status', () => getStatus());
}

module.exports = { registerTunnelHandlers, startTunnel, stopTunnel, getStatus };
