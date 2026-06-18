/* -------------------------------------------------------
 * pty.js — Electron Main-Process PTY Session Manager
 *
 * Spawns real pseudo-terminal sessions using node-pty.
 * Each session is identified by a unique ptyId (UUID).
 * The renderer communicates via IPC: create, write, resize, kill.
 *
 * Security: node-pty runs ONLY in the main process.
 * The renderer never has direct access to spawn shells.
 * ------------------------------------------------------- */

const { ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let pty;
try {
  pty = require('node-pty');
} catch (err) {
  console.error('[Causify PTY] Failed to load node-pty:', err.message);
  pty = null;
}

/* ── Active PTY sessions ── */
const sessions = new Map(); // ptyId -> { process, webContentsId }

/**
 * Detect the default shell for the current platform.
 */
function getDefaultShell() {
  if (process.platform === 'win32') {
    // Prefer PowerShell, fallback to cmd
    return process.env.COMSPEC || 'cmd.exe';
  }
  // macOS / Linux — use user's shell
  return process.env.SHELL || '/bin/bash';
}

/**
 * Get shell arguments for the platform.
 */
function getShellArgs(shell) {
  if (process.platform === 'win32') {
    // For PowerShell: use -NoLogo for clean output
    if (shell.toLowerCase().includes('powershell') || shell.toLowerCase().includes('pwsh')) {
      return ['-NoLogo'];
    }
    return [];
  }
  // Unix: login shell
  return ['-l'];
}

/**
 * Get the default working directory.
 */
function getDefaultCwd() {
  return os.homedir();
}

/**
 * Register all PTY-related IPC handlers.
 */
function registerPtyHandlers() {
  if (!pty) {
    console.warn('[Causify PTY] node-pty not available. Terminal feature disabled.');
    // Register stub handlers that return errors
    ipcMain.handle('pty:create', () => {
      throw new Error('node-pty is not available. Please install build tools and reinstall node-pty.');
    });
    ipcMain.handle('pty:write', () => {});
    ipcMain.handle('pty:resize', () => {});
    ipcMain.handle('pty:kill', () => {});
    return;
  }

  /* ── Create a new PTY session ── */
  ipcMain.handle('pty:create', (event, options = {}) => {
    const ptyId = crypto.randomUUID();
    const shell = options.shell || getDefaultShell();
    const cwd = options.cwd || getDefaultCwd();
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    try {
      const ptyProcess = pty.spawn(shell, getShellArgs(shell), {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });

      const webContentsId = event.sender.id;

      // Store the session
      sessions.set(ptyId, {
        process: ptyProcess,
        webContentsId,
      });

      // Forward PTY output to the renderer
      ptyProcess.onData((data) => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send(`pty:output-${ptyId}`, data);
          }
        } catch (err) {
          // WebContents destroyed — clean up
          cleanupSession(ptyId);
        }
      });

      // Handle PTY exit
      ptyProcess.onExit(({ exitCode, signal }) => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send(`pty:exit-${ptyId}`, { exitCode, signal });
          }
        } catch {
          // WebContents already destroyed
        }
        sessions.delete(ptyId);
      });

      console.log(`[Causify PTY] Created session ${ptyId.substring(0, 8)} (${shell}, ${cols}x${rows})`);
      return { ptyId };
    } catch (err) {
      console.error(`[Causify PTY] Failed to spawn shell:`, err.message);
      throw new Error(`Failed to spawn terminal: ${err.message}`);
    }
  });

  /* ── Write data (keystrokes) to a PTY ── */
  ipcMain.handle('pty:write', (_event, ptyId, data) => {
    const session = sessions.get(ptyId);
    if (session) {
      session.process.write(data);
    }
  });

  /* ── Resize a PTY ── */
  ipcMain.handle('pty:resize', (_event, ptyId, cols, rows) => {
    const session = sessions.get(ptyId);
    if (session && cols > 0 && rows > 0) {
      try {
        session.process.resize(cols, rows);
      } catch (err) {
        // PTY may have already exited
        console.warn(`[Causify PTY] Resize failed for ${ptyId.substring(0, 8)}:`, err.message);
      }
    }
  });

  /* ── Kill a specific PTY session ── */
  ipcMain.handle('pty:kill', (_event, ptyId) => {
    cleanupSession(ptyId);
  });
}

/**
 * Clean up a single PTY session.
 */
function cleanupSession(ptyId) {
  const session = sessions.get(ptyId);
  if (session) {
    try {
      session.process.kill();
    } catch {
      // Already dead
    }
    sessions.delete(ptyId);
    console.log(`[Causify PTY] Killed session ${ptyId.substring(0, 8)}`);
  }
}

/**
 * Kill ALL active PTY sessions (called on app quit).
 */
function killAllPtySessions() {
  const count = sessions.size;
  for (const [ptyId] of sessions) {
    cleanupSession(ptyId);
  }
  if (count > 0) {
    console.log(`[Causify PTY] Killed ${count} remaining session(s) on shutdown.`);
  }
}

module.exports = {
  registerPtyHandlers,
  killAllPtySessions,
};
