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
const fs = require('fs');

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

/* ── Spawn Backend ── */

async function spawnBackend(isDev = false) {
  // In dev mode, skip if port 8080 is already occupied
  if (isDev) {
    const portBusy = await isPortInUse(8080);
    if (portBusy) {
      console.log('[Backend] Port 8080 already in use — skipping spawn (backend running externally)');
      backendStatus = 'running';
      pushLog('[SYSTEM] Detected external backend on port 8080 — skipping spawn.');
      return;
    }
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

  console.log(`[Backend] Spawning: ${javaExe} -jar ${jarPath}`);
  pushLog(`[SYSTEM] Starting backend: java -jar ${path.basename(jarPath)}`);
  backendStatus = 'starting';

  return new Promise((resolve, reject) => {
    try {
      backendProcess = spawn(javaExe, [
        '-Xmx512m',
        '-Xms128m',
        '-jar',
        jarPath,
      ], {
        cwd: backendCwd,
        env: { ...process.env },
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

/* ── Kill Backend ── */

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
    killBackend();
    await new Promise((r) => setTimeout(r, 1000)); // Brief delay
    await spawnBackend(false);
    return backendStatus;
  });
}

module.exports = {
  registerBackendHandlers,
  spawnBackend,
  killBackend,
};
