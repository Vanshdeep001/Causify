/* -------------------------------------------------------
 * ipc/fileSystem.js — File System IPC Handlers
 *
 * Handles all file read/write operations and native dialogs.
 * ------------------------------------------------------- */

const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

/* ── File Type Filters ── */
const FILE_FILTERS = [
  { name: 'JavaScript', extensions: ['js'] },
  { name: 'JSX', extensions: ['jsx'] },
  { name: 'TypeScript', extensions: ['ts', 'tsx'] },
  { name: 'CSS', extensions: ['css'] },
  { name: 'HTML', extensions: ['html', 'htm'] },
  { name: 'JSON', extensions: ['json'] },
  { name: 'Python', extensions: ['py'] },
  { name: 'Java', extensions: ['java'] },
  { name: 'All Files', extensions: ['*'] },
];

/* ── Active file watchers ── */
const activeWatchers = new Map();

function registerFileSystemHandlers() {

  /* ── Save File (with dialog) ── */
  ipcMain.handle('dialog:save-file', async (_event, content, defaultName, filters) => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName || 'untitled.js',
      filters: filters || FILE_FILTERS,
    });

    if (result.canceled || !result.filePath) {
      return null; // User cancelled — frontend knows not to update state
    }

    try {
      fs.writeFileSync(result.filePath, content, 'utf-8');
      return {
        filePath: result.filePath,
        fileName: path.basename(result.filePath),
      };
    } catch (err) {
      throw new Error(`Failed to save file: ${err.message}`);
    }
  });

  /* ── Save File to Path (silent, no dialog) ── */
  ipcMain.handle('dialog:save-file-to-path', async (_event, content, filePath) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { filePath, fileName: path.basename(filePath) };
    } catch (err) {
      throw new Error(`Failed to save file: ${err.message}`);
    }
  });

  /* ── Open File (with dialog) ── */
  ipcMain.handle('dialog:open-file', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: FILE_FILTERS,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        content,
        filePath,
        fileName: path.basename(filePath),
      };
    } catch (err) {
      throw new Error(`Failed to read file: ${err.message}`);
    }
  });

  /* ── Read File by Path ── */
  ipcMain.handle('fs:read-file', async (_event, filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read file: ${err.message}`);
    }
  });

  /* ── Watch File for External Changes ── */
  ipcMain.on('fs:watch-file', (event, filePath) => {
    // Clean up existing watcher for this path
    if (activeWatchers.has(filePath)) {
      activeWatchers.get(filePath).close();
    }

    if (!fs.existsSync(filePath)) return;

    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            event.sender.send(`fs:file-changed:${filePath}`, {
              filePath,
              content,
              timestamp: Date.now(),
            });
          } catch { /* file might be mid-write */ }
        }
      });

      activeWatchers.set(filePath, watcher);

      // Cleanup when the renderer is destroyed
      event.sender.on('destroyed', () => {
        if (activeWatchers.has(filePath)) {
          activeWatchers.get(filePath).close();
          activeWatchers.delete(filePath);
        }
      });
    } catch (err) {
      console.error(`[FileSystem] Failed to watch file: ${err.message}`);
    }
  });

  /* ── Window Controls (for custom titlebar) ── */
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      event.sender.send('window:maximized-changed', win.isMaximized());
    }
  });

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false;
  });
}

module.exports = { registerFileSystemHandlers };
