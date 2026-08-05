/* -------------------------------------------------------
 * ipc/security.js — API Key Security & AI Proxy
 *
 * Protects the Google Gemini API key using Electron's
 * safeStorage (OS-level encryption):
 *   - macOS: Keychain
 *   - Windows: Credential Manager (DPAPI)
 *   - Linux: libsecret
 *
 * The API key NEVER leaves the main process.
 * The renderer only calls makeAIRequest() and receives
 * the response — it never sees the raw key.
 * ------------------------------------------------------- */

const { ipcMain, app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

/* ── Config Paths ── */
const CONFIG_DIR = app.getPath('userData');
const KEY_FILE = path.join(CONFIG_DIR, 'api-key.enc');
const SETUP_FILE = path.join(CONFIG_DIR, 'setup-complete.flag');

/* ── Gemini ──
 * Overridable by env, and must match what the backend uses — otherwise the
 * setup wizard would validate a key against a model the backend never calls. */
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/* ── Helpers ── */

/**
 * Turn a Gemini error into something the user can act on.
 *
 * Mirrors AiAnalysisService.describeFailure on the backend. The status alone
 * misleads: a 400 here usually means the model id is wrong for the region, and
 * a 403 on a short-term key normally means it expired rather than that it was
 * never valid.
 */
function describeGeminiFailure(status, body, modelId) {
  const detail = body || '';
  if (status === 400 && detail.includes('API_KEY_INVALID')) {
    return 'Google rejected this key as invalid. Check it was copied in full.';
  }
  if (status === 401 || status === 403) {
    return `Google rejected this key (${status}). Make sure the Gemini API is enabled for it.`;
  }
  if (status === 404) {
    return `No model named '${modelId}'. Check the model id.`;
  }
  if (status === 429) {
    return `Quota exhausted for '${modelId}'. Some models are capped at zero on free-tier keys (gemini-2.5-pro often is) — switch to gemini-2.5-flash, or wait for the quota to reset.`;
  }
  return `Gemini returned status ${status}${detail ? `: ${detail.slice(0, 300)}` : '.'}`;
}

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

  /* ── AI Request Proxy ── */

  ipcMain.handle('security:make-ai-request', async (_event, prompt, options = {}) => {
    const apiKey = retrieveApiKey();
    if (!apiKey) {
      return { error: 'API key not configured. Please set it in Settings.' };
    }

    try {
      const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // Sized for thinking + answer, not the answer alone: 2.5 models spend
          // several hundred tokens of this budget before writing anything, and
          // a tight limit comes back as an empty reply.
          maxOutputTokens: options.max_tokens || 3000,
          temperature: options.temperature ?? 0.4,
        },
      });

      const modelId = options.model || GEMINI_MODEL;

      const response = await fetch(`${GEMINI_BASE}${modelId}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header rather than ?key= — a key in a URL leaks into logs.
          'x-goog-api-key': apiKey,
        },
        body,
        signal: AbortSignal.timeout(90000),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return { error: describeGeminiFailure(response.status, errText, modelId) };
      }

      const data = await response.json();
      const content = (data?.candidates?.[0]?.content?.parts || [])
        .map((part) => part?.text || '')
        .join('');
      return { content, usage: data?.usageMetadata };
    } catch (err) {
      return { error: err.message || 'AI request failed' };
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
