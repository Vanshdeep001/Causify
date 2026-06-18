/* -------------------------------------------------------
 * clipboard.js — IPC Handler for Native Clipboard Operations
 *
 * Provides a secure IPC channel for the renderer process
 * to write images to the system clipboard using Electron's
 * nativeImage + clipboard APIs.
 * ------------------------------------------------------- */

const { ipcMain, clipboard, nativeImage } = require('electron');

function registerClipboardHandlers() {
  /**
   * Write an image (provided as a data URL) to the system clipboard.
   * Used by CodeShots to implement the "Copy Image" action.
   */
  ipcMain.handle('clipboard:write-image', async (_event, dataUrl) => {
    try {
      if (!dataUrl || typeof dataUrl !== 'string') {
        throw new Error('Invalid data URL');
      }

      const image = nativeImage.createFromDataURL(dataUrl);

      if (image.isEmpty()) {
        throw new Error('Failed to create image from data URL');
      }

      clipboard.writeImage(image);
      return { success: true };
    } catch (err) {
      console.error('[Clipboard] Failed to write image:', err.message);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerClipboardHandlers };
