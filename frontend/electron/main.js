/* -------------------------------------------------------
 * main.js — Electron Main Process
 *
 * Responsibilities:
 *   - BrowserWindow creation & lifecycle
 *   - Spring Boot backend process management
 *   - IPC handler registration
 *   - Auto-updater initialization
 *   - Single instance lock
 * ------------------------------------------------------- */

const { app, BrowserWindow, dialog, crashReporter, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

// IPC handler modules
const { registerFileSystemHandlers } = require('./ipc/fileSystem');
const { registerBackendHandlers, spawnBackend, killBackend } = require('./ipc/backend');
const { registerUpdaterHandlers } = require('./ipc/updater');
const { registerSecurityHandlers } = require('./ipc/security');
const { registerClipboardHandlers } = require('./ipc/clipboard');
const { registerPtyHandlers, killAllPtySessions } = require('./ipc/pty');
const { registerDeployHandlers, killAllDeploySessions } = require('./ipc/deploy');
const { registerCaptureHandlers } = require('./ipc/capture');
const { registerGuardianHandlers } = require('./ipc/guardian');

/* ── Constants ── */
const isDev = !app.isPackaged;
const VITE_DEV_URL = 'http://localhost:5173';
const MIN_WIDTH = 1000;
const MIN_HEIGHT = 700;

/* ── Crash Reporter ── */
const crashDir = path.join(app.getPath('userData'), 'crashes');
if (!fs.existsSync(crashDir)) fs.mkdirSync(crashDir, { recursive: true });
crashReporter.start({
  submitURL: '',           // No remote reporting — local only
  uploadToServer: false,
  compress: false,
});

/* ── Single Instance Lock ── */
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

/* ── Main Window ── */
let mainWindow = null;

function createWindow() {
  // Resolve the app icon
  const iconPath = isDev
    ? path.join(__dirname, '..', 'public', 'icon.ico')
    : path.join(__dirname, '..', 'dist', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    icon: iconPath,
    // TODO: Change to frame: false when custom titlebar with
    // -webkit-app-region: drag and min/max/close buttons
    // is added to the React header component (App.jsx).
    frame: true,
    backgroundColor: '#0a0a0f',
    show: false, // Show after ready-to-show to avoid flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for preload script fs access
    },
  });

  // Show window when ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Load content
  if (isDev) {
    // In dev mode, wait for Vite to be ready
    loadDevURL();
  } else {
    // In production, load built files
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Wait for Vite dev server to be ready, then load it.
 * Retries every 500ms for up to 30 seconds.
 */
async function loadDevURL(retries = 60) {
  for (let i = 0; i < retries; i++) {
    try {
      const http = require('http');
      await new Promise((resolve, reject) => {
        const req = http.get(VITE_DEV_URL, (res) => {
          res.resume();
          resolve();
        });
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      // Vite is ready
      mainWindow.loadURL(VITE_DEV_URL);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  // Vite never started
  dialog.showErrorBox(
    'Development Server Not Found',
    'Could not connect to Vite dev server at http://localhost:5173.\n\nMake sure to run "npm run dev" first, or use "npm run electron:dev" to start both.'
  );
  app.quit();
}

/* ── App Lifecycle ── */

app.on('second-instance', (_event, argv) => {
  // If user tries to open a second instance, focus the existing window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }

  // On Windows/Linux, the causify:// URL is passed in argv
  const deepLinkUrl = argv.find(arg => arg.startsWith('causify://'));
  if (deepLinkUrl && mainWindow) {
    handleDeepLink(deepLinkUrl);
  }
});

// macOS: handle causify:// URLs via open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('causify://') && mainWindow) {
    handleDeepLink(url);
  }
});

/**
 * Parse a causify:// deep-link URL and send navigation data to the renderer.
 */
function handleDeepLink(url) {
  try {
    const qIndex = url.indexOf('?');
    if (qIndex === -1) return;

    const params = new URLSearchParams(url.substring(qIndex + 1));
    const data = {
      projectId: params.get('project'),
      filePath: params.get('file'),
      startLine: parseInt(params.get('start'), 10) || null,
      endLine: parseInt(params.get('end'), 10) || null,
      nodeId: params.get('node') || null,
    };

    if (data.filePath && mainWindow) {
      mainWindow.webContents.send('navigate-to-codeshot', data);
    }
  } catch (err) {
    console.error('[Electron] Failed to parse deep link:', err.message);
  }
}

app.whenReady().then(async () => {
  // Register all IPC handlers
  registerFileSystemHandlers();
  registerBackendHandlers();
  registerUpdaterHandlers();
  registerSecurityHandlers();
  registerClipboardHandlers();
  registerPtyHandlers();
  registerDeployHandlers();
  registerCaptureHandlers();
  registerGuardianHandlers();

  // Allow renderer getDisplayMedia() to record the screen without a picker.
  // Electron requires an explicit handler; we auto-grant the primary screen.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => {
        if (sources && sources.length > 0) {
          callback({ video: sources[0] }); // primary screen, video only
        } else {
          callback({});
        }
      })
      .catch(() => callback({}));
  });

  // Register causify:// custom protocol for deep links
  app.setAsDefaultProtocolClient('causify');

  // Spawn backend (skips in dev if port 8080 is already in use)
  try {
    await spawnBackend(isDev);
  } catch (err) {
    console.error('[Electron] Backend spawn error:', err.message);
    if (!isDev) {
      // Determine a helpful message based on the error
      let userMessage = err.message;
      let detail = '';

      if (err.message.includes('Java not found') || err.message.includes('ENOENT')) {
        userMessage = 'Java is not installed on this computer.';
        detail = 'Causify requires Java 17 or later to run.\n\n'
          + 'Download Java from:\nhttps://adoptium.net/temurin/releases/\n\n'
          + 'After installing Java, restart Causify.';
      } else if (err.message.includes('code 1')) {
        userMessage = 'Backend failed to start (Java may be outdated).';
        detail = 'This usually means Java is installed but the version is too old.\n\n'
          + 'Causify requires Java 17+. Check your version:\n  java -version\n\n'
          + 'Download the latest from:\nhttps://adoptium.net/temurin/releases/';
      }

      const response = dialog.showMessageBoxSync({
        type: 'error',
        title: 'Backend Failed to Start',
        message: userMessage,
        detail: detail,
        buttons: ['Retry', 'Continue Without Backend', 'Quit'],
        defaultId: 0,
      });
      if (response === 0) {
        try { await spawnBackend(false); } catch { /* continue anyway */ }
      } else if (response === 2) {
        app.quit();
        return;
      }
    }
  }

  createWindow();
});

app.on('window-all-closed', () => {
  killAllPtySessions();
  killAllDeploySessions();
  killBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  killAllPtySessions();
  killBackend();
});

/* ── Export mainWindow getter for IPC handlers ── */
module.exports.getMainWindow = () => mainWindow;
