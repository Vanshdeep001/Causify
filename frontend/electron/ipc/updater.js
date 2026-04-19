/* -------------------------------------------------------
 * ipc/updater.js — Auto-Update Handlers
 *
 * Wires electron-updater events to IPC events that the
 * renderer can listen to. Uses GitHub Releases as the
 * update provider.
 * ------------------------------------------------------- */

const { ipcMain, app } = require('electron');

let autoUpdater = null;

/**
 * Lazy-load electron-updater.
 * In dev mode, autoUpdater is unavailable — all calls
 * become no-ops gracefully.
 */
function getAutoUpdater() {
  if (autoUpdater) return autoUpdater;

  try {
    const { autoUpdater: updater } = require('electron-updater');
    autoUpdater = updater;

    // Don't auto-download — let user control it
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    return autoUpdater;
  } catch (err) {
    console.log('[Updater] electron-updater not available:', err.message);
    return null;
  }
}

function registerUpdaterHandlers() {
  const updater = getAutoUpdater();

  // Wire up updater events → renderer IPC events
  if (updater) {
    updater.on('update-available', (info) => {
      sendToRenderer('update:available', info);
    });

    updater.on('download-progress', (progress) => {
      sendToRenderer('update:progress', progress);
    });

    updater.on('update-downloaded', (info) => {
      sendToRenderer('update:downloaded', info);
    });

    updater.on('error', (err) => {
      // Silently log — don't show error to user
      console.error('[Updater] Error:', err.message);
    });

    // Check for updates on startup (after a brief delay)
    if (app.isPackaged) {
      setTimeout(() => {
        try {
          updater.checkForUpdates().catch(() => {
            // Silently ignore — update server unreachable
          });
        } catch { /* ignore */ }
      }, 5000);
    }
  }

  /* ── IPC Handlers ── */

  ipcMain.handle('update:check', async () => {
    if (!updater) return { error: 'Updater not available in development mode' };
    try {
      const result = await updater.checkForUpdates();
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('update:install', () => {
    if (!updater) return;
    updater.quitAndInstall(false, true);
  });

  /* ── App Info ── */

  ipcMain.handle('app:get-version', () => app.getVersion());
}

/**
 * Send an event to the renderer's focused window.
 */
function sendToRenderer(channel, data) {
  const { BrowserWindow } = require('electron');
  const wins = BrowserWindow.getAllWindows();
  wins.forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  });
}

module.exports = { registerUpdaterHandlers };
