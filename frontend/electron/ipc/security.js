/* -------------------------------------------------------
 * ipc/security.js — API Key Security & AI Proxy
 *
 * Protects the user's AI provider key using Electron's
 * safeStorage (OS-level encryption):
 *   - macOS: Keychain
 *   - Windows: Credential Manager (DPAPI)
 *   - Linux: libsecret
 *
 * Storage only. Provider selection, validation and every LLM call live in the
 * backend, which is the single place that knows how each vendor is addressed —
 * a second implementation here would drift out of step with the one actually
 * serving requests.
 * ------------------------------------------------------- */

const { ipcMain, app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

/* ── Config Paths ── */
const CONFIG_DIR = app.getPath('userData');
const KEY_FILE = path.join(CONFIG_DIR, 'api-key.enc');
const SETUP_FILE = path.join(CONFIG_DIR, 'setup-complete.flag');


/* ── Helpers ── */

/**
 * Encrypt and store the API key.
 */
function storeApiKey(key) {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: store in plain text (rare edge case on some Linux distros)
    fs.writeFileSync(KEY_FILE, key, 'utf-8');
    return;
  }
  const encrypted = safeStorage.encryptString(key);
  fs.writeFileSync(KEY_FILE, encrypted);
}

/**
 * Retrieve and decrypt the API key.
 */
function retrieveApiKey() {
  if (!fs.existsSync(KEY_FILE)) return null;

  try {
    const data = fs.readFileSync(KEY_FILE);

    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback: plain text
      return data.toString('utf-8');
    }

    return safeStorage.decryptString(data);
  } catch (err) {
    console.error('[Security] Failed to decrypt API key:', err.message);
    return null;
  }
}

/**
 * Check if first-launch setup has been completed.
 */
function isSetupComplete() {
  return fs.existsSync(SETUP_FILE);
}

/* ── IPC Registration ── */

function registerSecurityHandlers() {

  /* ── API Key Management ── */

  ipcMain.handle('security:set-api-key', async (_event, key) => {
    try {
      storeApiKey(key);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('security:has-api-key', () => {
    return fs.existsSync(KEY_FILE);
  });

  ipcMain.handle('security:clear-api-key', () => {
    try {
      if (fs.existsSync(KEY_FILE)) fs.unlinkSync(KEY_FILE);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  /* ── First Launch / Setup ── */

  ipcMain.handle('app:is-first-launch', () => {
    return !isSetupComplete();
  });

  ipcMain.handle('app:complete-setup', () => {
    try {
      fs.writeFileSync(SETUP_FILE, new Date().toISOString(), 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerSecurityHandlers, retrieveApiKey };
