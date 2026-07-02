/* -------------------------------------------------------
 * guardian.js — Repository Guardian API client
 *
 * Talks to the Repository Guardian daemon's read-only local
 * API (127.0.0.1:8787/api/*). The API token is fetched once
 * from the Electron main process (which reads it from disk);
 * the renderer itself never touches the filesystem.
 *
 * Everything here is READ-ONLY: the daemon cannot merge,
 * delete, or push from these endpoints.
 * ------------------------------------------------------- */

const BASE_URL = 'http://127.0.0.1:8787';

let cachedToken = null;

const getToken = async () => {
  if (!cachedToken && window.electronAPI?.guardianGetToken) {
    cachedToken = await window.electronAPI.guardianGetToken();
  }
  return cachedToken;
};

/** Drop the cached token (e.g. after daemon restart regenerates it). */
export const resetGuardianToken = () => { cachedToken = null; };

const apiGet = async (path) => {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'X-GitPilot-Token': token || '' },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Guardian API error (HTTP ${res.status})`);
  }
  return res.json();
};

/* ── Daemon liveness (no auth needed) ── */
export const guardianHealth = async () => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
};

/* ── Read-only intelligence endpoints ── */
export const guardianStatus = () => apiGet('/api/status');
export const guardianApprovals = () => apiGet('/api/approvals');
export const guardianAudit = (limit = 30) => apiGet(`/api/audit?limit=${limit}`);
export const guardianPrs = () => apiGet('/api/prs');
export const guardianBranches = () => apiGet('/api/branches');

/* ── Local process management (via Electron main) ── */
export const guardianDetect = () =>
  window.electronAPI?.guardianDetect
    ? window.electronAPI.guardianDetect()
    : Promise.resolve({ installed: false, running: false, tokenExists: false });

export const guardianSetup = (options) => window.electronAPI.guardianSetup(options);
export const guardianStart = (repoUrl) => window.electronAPI.guardianStart(repoUrl);
export const guardianStop = () => window.electronAPI.guardianStop();

export const isElectron = () => !!window.electronAPI?.guardianDetect;
