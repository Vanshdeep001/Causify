/* -------------------------------------------------------
 * ipc/capture.js — Screen Capture & Recording IPC Handlers
 *
 * Provides:
 *   - capture:screen-thumbnail  → full-screen PNG (data URL)
 *   - capture:save-binary       → save a base64 blob (png/webm) to disk
 *
 * Screen recording itself happens in the renderer via
 * getDisplayMedia() + MediaRecorder (see ScreenCapture.jsx);
 * this module only supplies still frames and binary saving.
 * ------------------------------------------------------- */

const { ipcMain, dialog, BrowserWindow, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');

function registerCaptureHandlers() {

  /* ── Full-screen screenshot → PNG data URL ── */
  ipcMain.handle('capture:screen-thumbnail', async () => {
    try {
      const primary = screen.getPrimaryDisplay();
      const { width, height } = primary.size;
      const scale = primary.scaleFactor || 1;

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(width * scale),
          height: Math.round(height * scale),
        },
      });

      if (!sources.length) {
        return { error: 'No screen source available' };
      }

      return { dataUrl: sources[0].thumbnail.toDataURL() };
    } catch (err) {
      console.error('[Capture] Screenshot failed:', err.message);
      return { error: err.message };
    }
  });

  /* ── Save a base64-encoded binary blob (image/video) via dialog ── */
  ipcMain.handle('capture:save-binary', async (_event, base64, defaultName, filters) => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || 'capture.webm',
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    });

    if (result.canceled || !result.filePath) {
      return null; // user cancelled
    }

    try {
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(result.filePath, buffer);
      return {
        filePath: result.filePath,
        fileName: path.basename(result.filePath),
      };
    } catch (err) {
      throw new Error(`Failed to save capture: ${err.message}`);
    }
  });
}

module.exports = { registerCaptureHandlers };
