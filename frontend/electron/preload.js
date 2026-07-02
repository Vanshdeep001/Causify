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

  saveTempFile: (options) =>
    ipcRenderer.invoke('fs:save-temp-file', options),

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

  /* ── CodeShot Deep Link ── */
  onCodeShotNavigate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('navigate-to-codeshot', handler);
    return () => ipcRenderer.removeListener('navigate-to-codeshot', handler);
  },

  /* ── Clipboard Image (native) ── */
  writeImageToClipboard: (dataUrl) =>
    ipcRenderer.invoke('clipboard:write-image', dataUrl),

  /* ── Screen Capture / Recording ── */
  captureScreenshot: () =>
    ipcRenderer.invoke('capture:screen-thumbnail'),

  saveBinaryFile: (base64, defaultName, filters) =>
    ipcRenderer.invoke('capture:save-binary', base64, defaultName, filters),

  /* ── Terminal PTY ── */
  createPty: (options) =>
    ipcRenderer.invoke('pty:create', options),

  writePty: (ptyId, data) =>
    ipcRenderer.invoke('pty:write', ptyId, data),

  resizePty: (ptyId, cols, rows) =>
    ipcRenderer.invoke('pty:resize', ptyId, cols, rows),

  killPty: (ptyId) =>
    ipcRenderer.invoke('pty:kill', ptyId),

  onPtyOutput: (ptyId, callback) => {
    const channel = `pty:output-${ptyId}`;
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  onPtyExit: (ptyId, callback) => {
    const channel = `pty:exit-${ptyId}`;
    const handler = (_event, exitInfo) => callback(exitInfo);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /* ── Deploy (Vercel) ── */
  setVercelToken: (token) =>
    ipcRenderer.invoke('deploy:set-token', token),

  hasVercelToken: () =>
    ipcRenderer.invoke('deploy:has-token'),

  clearVercelToken: () =>
    ipcRenderer.invoke('deploy:clear-token'),

  validateVercelToken: (token) =>
    ipcRenderer.invoke('deploy:validate-token', token),

  detectFramework: (cwd) =>
    ipcRenderer.invoke('deploy:detect-framework', cwd),

  prepareDeployWorkspace: (options) =>
    ipcRenderer.invoke('deploy:prepare', options),

  listVercelProjects: () =>
    ipcRenderer.invoke('deploy:list-projects'),

  getLinkedVercelProject: (options) =>
    ipcRenderer.invoke('deploy:get-linked', options),

  linkVercelProject: (options) =>
    ipcRenderer.invoke('deploy:link-project', options),

  runDeploy: (options) =>
    ipcRenderer.invoke('deploy:run', options),

  cancelDeploy: (deployId) =>
    ipcRenderer.invoke('deploy:cancel', deployId),

  onDeployLog: (deployId, callback) => {
    const channel = `deploy:log-${deployId}`;
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  onDeployComplete: (deployId, callback) => {
    const channel = `deploy:complete-${deployId}`;
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  detectEnvFiles: (cwd) =>
    ipcRenderer.invoke('deploy:detect-env', cwd),

  pushEnvVars: (options) =>
    ipcRenderer.invoke('deploy:push-env', options),

  /* ── Repository Guardian ── */
  guardianDetect: () =>
    ipcRenderer.invoke('guardian:detect'),

  guardianGetToken: () =>
    ipcRenderer.invoke('guardian:get-token'),

  guardianSetup: (options) =>
    ipcRenderer.invoke('guardian:setup', options),

  guardianStart: (repoUrl) =>
    ipcRenderer.invoke('guardian:start', repoUrl),

  guardianStop: () =>
    ipcRenderer.invoke('guardian:stop'),
});
