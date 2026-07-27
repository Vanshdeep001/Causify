/* -------------------------------------------------------
 * ipc/backend.js — Spring Boot Backend Process Manager
 *
 * Manages the Spring Boot JAR as a child process:
 *   - Spawn with JVM memory flags
 *   - Detect readiness via stdout parsing
 *   - Rolling log buffer for Output Hub
 *   - Graceful shutdown on quit
 *   - Port conflict detection in dev mode
 * ------------------------------------------------------- */

const { ipcMain, app, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { retrieveApiKey } = require('./security');

/* ── State ── */
let backendProcess = null;
let backendStatus = 'stopped';  // 'stopped' | 'starting' | 'running' | 'error'
const logBuffer = [];
const MAX_LOG_LINES = 500;

/* ── Helpers ── */

/**
 * Check if a port is already in use.
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const conn = net.createConnection({ port, host: '127.0.0.1' });
    conn.on('connect', () => { conn.end(); resolve(true); });
    conn.on('error', () => resolve(false));
    conn.setTimeout(1000, () => { conn.destroy(); resolve(false); });
  });
}

/**
 * Append a line to the rolling log buffer.
 */
function pushLog(line) {
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) {
    logBuffer.shift();
  }
}

/**
 * Get the path to the backend JAR.
 * - Production: resources/backend/causify-backend.jar (via extraResources)
 * - Development: ../../backend/target/debugsync-backend-1.0.0.jar
 */
function getJarPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'causify-backend.jar');
  }
  // Dev mode — look for the Maven-built JAR
  const devJar = path.join(__dirname, '..', '..', '..', 'backend', 'target', 'debugsync-backend-1.0.0.jar');
  return devJar;
}

/**
 * Get the working directory for the backend.
 */
function getBackendCwd() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend');
  }
  return path.join(__dirname, '..', '..', '..', 'backend');
}

/* ── Database Location ── */

/**
 * Where the H2 database should live.
 *
 * The backend's JDBC URL resolves its data directory relative to the working
 * directory unless CAUSIFY_DATA_DIR overrides it. In a packaged install that put
 * the database inside resources/backend/data — i.e. inside the app itself, which
 * the NSIS updater replaces on every update and which a Program Files install
 * cannot write at all. userData is per-user, writable, and survives updates,
 * which is where the rest of our state (api-key.enc, render-links.json) already
 * lives.
 *
 * H2 accepts forward slashes on every platform; using them avoids any ambiguity
 * over backslash escaping inside the JDBC URL.
 */
function getDataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function toJdbcPath(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Move a pre-existing database out of the install directory into userData.
 *
 * Runs only for packaged builds: in development the backend is usually started
 * separately with Maven, and silently relocating backend/data out from under it
 * would be surprising.
 *
 * The lock file is deliberately not carried over — it describes a process that
 * is no longer running, and H2 recreates it on open. Failures here are logged
 * and swallowed: a failed migration must never stop the app from starting.
 */
function migrateLegacyDatabase() {
  if (!app.isPackaged) return;

  const legacyDir = path.join(getBackendCwd(), 'data');
  const targetDir = getDataDir();

  try {
    const legacyDb = path.join(legacyDir, 'debugsync.mv.db');
    const targetDb = path.join(targetDir, 'debugsync.mv.db');

    if (!fs.existsSync(legacyDb)) return;      // nothing to migrate
    if (fs.existsSync(targetDb)) return;       // already migrated — never clobber

    fs.mkdirSync(targetDir, { recursive: true });

    for (const name of ['debugsync.mv.db', 'debugsync.trace.db']) {
      const from = path.join(legacyDir, name);
      const to = path.join(targetDir, name);
      if (!fs.existsSync(from)) continue;
      try {
        fs.renameSync(from, to);
      } catch (err) {
        // Different volume (custom install location) — fall back to copy + remove.
        if (err.code !== 'EXDEV') throw err;
        fs.copyFileSync(from, to);
        try { fs.unlinkSync(from); } catch { /* best effort */ }
      }
    }

    console.log(`[Backend] Migrated database from ${legacyDir} to ${targetDir}`);
    pushLog('[SYSTEM] Moved the database into your user profile so app updates no longer reset it.');
  } catch (err) {
    console.error('[Backend] Database migration failed:', err.message);
    pushLog(`[WARN] Could not relocate the database: ${err.message}`);
  }
}

/**
 * Choose a max heap for the backend.
 *
 * This was pinned at 512 MB, which a project of any size could exhaust while
 * H2 read file contents — the OutOfMemoryError then panicked MVStore and closed
 * the database for the rest of the process's life. Scale with the machine but
 * stay modest, since this runs alongside Electron and the user's own dev server.
 */
function getMaxHeapMb() {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  const quarter = Math.floor(totalMb / 4);
  return Math.max(768, Math.min(2048, quarter));
}

/* ── Spawn Backend ── */

async function spawnBackend(isDev = false) {
  // Always check if port 8080 is already occupied (external backend running)
  const portBusy = await isPortInUse(8080);
  if (portBusy) {
    console.log('[Backend] Port 8080 already in use — skipping spawn (backend running externally)');
    backendStatus = 'running';
    pushLog('[SYSTEM] Detected external backend on port 8080 — skipping spawn.');
    return;
  }

  const jarPath = getJarPath();
  const backendCwd = getBackendCwd();

  // Check if JAR exists (in production)
  if (app.isPackaged && !fs.existsSync(jarPath)) {
    backendStatus = 'error';
    const msg = `Backend JAR not found at: ${jarPath}`;
    pushLog(`[ERROR] ${msg}`);
    throw new Error(msg);
  }

  // In dev mode, if JAR doesn't exist, skip gracefully
  if (!app.isPackaged && !fs.existsSync(jarPath)) {
    console.log('[Backend] No JAR found in dev mode — run backend manually with Maven');
    backendStatus = 'stopped';
    pushLog('[SYSTEM] No packaged JAR found. Run backend manually: mvn spring-boot:run');
    return;
  }

  // Find java executable — comprehensive search on Windows
  let javaExe = null;

  // 1. Check JAVA_HOME first
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, 'bin', 'java');
    if (fs.existsSync(candidate + '.exe') || fs.existsSync(candidate)) {
      javaExe = candidate;
      console.log(`[Backend] Java from JAVA_HOME: ${javaExe}`);
    }
  }

  // 2. Search common Windows installation paths
  if (!javaExe) {
    const searchDirs = [
      'C:\\Java',
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Common Files\\Oracle\\Java\\javapath',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft\\jdk',
      path.join(process.env['LOCALAPPDATA'] || '', 'Programs\\Eclipse Adoptium'),
    ].filter(Boolean);

    for (const dir of searchDirs) {
      try {
        if (!fs.existsSync(dir)) continue;

        // Check if java.exe exists directly in this dir (e.g. Oracle javapath)
        const directJava = path.join(dir, 'java.exe');
        if (fs.existsSync(directJava)) {
          javaExe = directJava;
          console.log(`[Backend] Found Java directly at: ${javaExe}`);
          break;
        }

        // Search for JDK subdirectories
        const jdks = fs.readdirSync(dir)
          .filter(d => d.startsWith('jdk') || d.startsWith('java'))
          .sort()
          .reverse();
        for (const jdk of jdks) {
          const candidate = path.join(dir, jdk, 'bin', 'java');
          if (fs.existsSync(candidate + '.exe') || fs.existsSync(candidate)) {
            javaExe = candidate;
            console.log(`[Backend] Found Java at: ${javaExe}`);
            break;
          }
        }
        if (javaExe) break;
      } catch (err) {
        // Continue to next directory
      }
    }
  }

  // 3. Fallback to PATH
  if (!javaExe) {
    javaExe = 'java';
    console.log('[Backend] Falling back to java on PATH');
  }

  // Relocate any database still sitting in the install directory. Done here,
  // immediately before launch, so the file is moved while nothing holds it and
  // only on a path that actually starts the backend.
  migrateLegacyDatabase();
  const dataDir = getDataDir();
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (err) {
    console.error('[Backend] Could not create data directory:', err.message);
  }

  console.log(`[Backend] Spawning: ${javaExe} -jar ${jarPath}`);
  pushLog(`[SYSTEM] Starting backend: java -jar ${path.basename(jarPath)} (max heap ${getMaxHeapMb()} MB)`);
  backendStatus = 'starting';

  // Hand the stored OpenRouter key (safeStorage-encrypted) to the backend —
  // AiAnalysisService reads it from the OPENROUTER_API_KEY env var.
  const storedApiKey = retrieveApiKey();

  return new Promise((resolve, reject) => {
    try {
      backendProcess = spawn(javaExe, [
        `-Xmx${getMaxHeapMb()}m`,
        '-Xms128m',
        '-jar',
        jarPath,
      ], {
        cwd: backendCwd,
        env: {
          ...process.env,
          // Keeps the H2 file in the user profile rather than the install dir.
          CAUSIFY_DATA_DIR: toJdbcPath(dataDir),
          ...(storedApiKey ? { OPENROUTER_API_KEY: storedApiKey } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let resolved = false;

      backendProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach((line) => {
          pushLog(line);

          // Forward to renderer
          const { getMainWindow } = require('../main');
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('backend:log', line);
          }

          // Detect readiness
          if (line.includes('Started DebugSyncApplication')) {
            backendStatus = 'running';
            pushLog('[SYSTEM] ✓ Backend is ready');
            if (win && !win.isDestroyed()) {
              win.webContents.send('backend:ready');
            }
            if (!resolved) { resolved = true; resolve(); }
          }
        });
      });

      backendProcess.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        lines.forEach((line) => {
          pushLog(`[STDERR] ${line}`);

          const { getMainWindow } = require('../main');
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('backend:log', `[ERR] ${line}`);
          }
        });
      });

      backendProcess.on('error', (err) => {
        backendStatus = 'error';
        pushLog(`[ERROR] Failed to start backend: ${err.message}`);

        if (err.code === 'ENOENT') {
          const msg = 'Java not found. Please install JDK 17+ and ensure JAVA_HOME is set.';
          pushLog(`[ERROR] ${msg}`);
          if (!resolved) { resolved = true; reject(new Error(msg)); }
        } else {
          if (!resolved) { resolved = true; reject(err); }
        }
      });

      backendProcess.on('exit', (code, signal) => {
        const reason = signal ? `signal ${signal}` : `code ${code}`;
        pushLog(`[SYSTEM] Backend process exited (${reason})`);
        backendStatus = 'stopped';
        backendProcess = null;

        if (!resolved) {
          resolved = true;
          if (code !== 0) {
            reject(new Error(`Backend exited with ${reason}`));
          } else {
            resolve();
          }
        }
      });

      // Timeout — if backend hasn't started after 60s, resolve anyway
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (backendStatus === 'starting') {
            pushLog('[WARN] Backend startup timed out (60s) — continuing anyway');
            backendStatus = 'running'; // Assume it's still starting
          }
          resolve();
        }
      }, 60000);

    } catch (err) {
      backendStatus = 'error';
      reject(err);
    }
  });
}

/* ── Shutdown ── */

/**
 * Ask the backend to close its application context, then wait for it to exit.
 *
 * A force-kill leaves H2 with no chance to release its file lock and orphans any
 * dev-server child processes. Asking first lets @PreDestroy hooks run; the
 * force-kill below stays as a fallback so quitting can never hang.
 *
 * Resolves (never rejects) once the process is gone or the deadline passes.
 */
function shutdownBackend(timeoutMs = 6000) {
  const proc = backendProcess;

  // Nothing we started — e.g. a developer's own backend already on 8080. Leave it be.
  if (!proc) return Promise.resolve();

  pushLog('[SYSTEM] Requesting graceful backend shutdown...');

  const exited = new Promise((resolve) => proc.once('exit', () => resolve('exited')));
  const deadline = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));

  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: 8080,
        path: '/api/system/shutdown',
        method: 'POST',
        timeout: 2000,
      },
      (res) => { res.resume(); resolve(); }   // drain so the socket closes
    );
    req.on('error', () => resolve());          // backend already gone or unreachable
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.end();
  })
    .then(() => Promise.race([exited, deadline]))
    .then((outcome) => {
      if (outcome !== 'exited') {
        pushLog('[WARN] Backend did not exit in time — terminating.');
        killBackend();
      }
    })
    .catch(() => killBackend());
}

/* ── Kill Backend (forceful) ── */

function killBackend() {
  if (!backendProcess) return;

  console.log('[Backend] Shutting down...');
  pushLog('[SYSTEM] Shutting down backend...');

  try {
    // Try graceful shutdown first
    if (process.platform === 'win32') {
      // Windows: use taskkill for the process tree (full path since PATH may not include System32)
      const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
      spawn(taskkill, ['/pid', backendProcess.pid.toString(), '/T', '/F'], { stdio: 'ignore' });
    } else {
      backendProcess.kill('SIGTERM');

      // Force kill after 5 seconds if still alive
      setTimeout(() => {
        if (backendProcess && !backendProcess.killed) {
          backendProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  } catch (err) {
    console.error('[Backend] Error killing process:', err.message);
  }

  backendProcess = null;
  backendStatus = 'stopped';
}

/* ── IPC Registration ── */

function registerBackendHandlers() {
  ipcMain.handle('backend:get-status', () => backendStatus);

  ipcMain.handle('backend:get-logs', () => [...logBuffer]);

  ipcMain.handle('backend:restart', async () => {
    // Shut down cleanly so H2 releases its file lock before we reopen it —
    // a forced restart used to leave the next start fighting a stale lock.
    await shutdownBackend();
    await new Promise((r) => setTimeout(r, 1000)); // Brief delay
    await spawnBackend(false);
    return backendStatus;
  });
}

module.exports = {
  registerBackendHandlers,
  spawnBackend,
  shutdownBackend,
  killBackend,
};
