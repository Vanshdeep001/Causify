/* -------------------------------------------------------
 * preload.js — Secure IPC Bridge
 *
 * Exposes a safe API to the renderer process via
 * contextBridge. The renderer accesses these methods
 * through window.electronAPI.
 *
 * Security: contextIsolation = true, nodeIntegration = false.
 * The renderer never has direct access to Node.js or Electron.
 * ------------------------------------------------------- */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  /* ── File System ── */
  saveFile: (content, defaultName, filters) =>
    ipcRenderer.invoke('dialog:save-file', content, defaultName, filters),

  saveFileToPath: (content, filePath) =>
    ipcRenderer.invoke('dialog:save-file-to-path', content, filePath),

  openFile: () =>
    ipcRenderer.invoke('dialog:open-file'),

  readFile: (filePath) =>
    ipcRenderer.invoke('fs:read-file', filePath),

  watchFile: (filePath, callback) => {
    const channel = `fs:file-changed:${filePath}`;
    ipcRenderer.send('fs:watch-file', filePath);
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /* ── Window Controls (for future custom titlebar) ── */
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

  onMaximizedChange: (callback) => {
    const handler = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on('window:maximized-changed', handler);
    return () => ipcRenderer.removeListener('window:maximized-changed', handler);
  },

  /* ── Backend (Spring Boot) ── */
  getBackendStatus: () => ipcRenderer.invoke('backend:get-status'),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
  getBackendLogs: () => ipcRenderer.invoke('backend:get-logs'),

  onBackendReady: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('backend:ready', handler);
    return () => ipcRenderer.removeListener('backend:ready', handler);
  },

  onBackendLog: (callback) => {
    const handler = (_event, line) => callback(line);
    ipcRenderer.on('backend:log', handler);
    return () => ipcRenderer.removeListener('backend:log', handler);
  },

  /* ── Auto Updates ── */
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),

  onUpdateAvailable: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },

  onUpdateDownloaded: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('update:downloaded', handler);
    return () => ipcRenderer.removeListener('update:downloaded', handler);
  },

  onUpdateProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },

  /* ── AI / Security ── */
  makeAIRequest: (prompt, options) =>
    ipcRenderer.invoke('security:make-ai-request', prompt, options),

  setApiKey: (key) =>
    ipcRenderer.invoke('security:set-api-key', key),

  hasApiKey: () =>
    ipcRenderer.invoke('security:has-api-key'),

  clearApiKey: () =>
    ipcRenderer.invoke('security:clear-api-key'),

  /* ── App Info ── */
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  isFirstLaunch: () => ipcRenderer.invoke('app:is-first-launch'),
  completeSetup: () => ipcRenderer.invoke('app:complete-setup'),
});
