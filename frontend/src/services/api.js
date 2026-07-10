/* -------------------------------------------------------
 * api.js — API Service Layer
 * ------------------------------------------------------- */

import axios from 'axios';

// In production Electron the app is loaded via file:// protocol,
// so relative URLs don't work — point directly at the local backend.
const isElectronProd =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'file:' || window.electronAPI);

const BACKEND_ORIGIN = isElectronProd ? 'http://127.0.0.1:8080' : '';

// Create an Axios instance with defaults
const api = axios.create({
  baseURL: `${BACKEND_ORIGIN}/api`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000, // default: fine for quick CRUD (save, status, lookups)
});

// Some operations are inherently slow and must not share the 30s CRUD deadline,
// or they abort mid-flight with "timeout of 30000ms exceeded":
//   HEAVY — large uploads and git clone (lots of data / full network fetch)
//   LONG  — git push/pull/commit and code execution
//   AI    — LLM round-trips (root-cause, key verification)
const TIMEOUT = { HEAVY: 300000, LONG: 120000, AI: 120000 };

/* ---- Session APIs ---- */

export const createSession = async (name, username, password) => {
  const response = await api.post('/session/create', { name, username, password });
  return response.data;
};

export const joinSession = async (id, password, username) => {
  const response = await api.post('/session/join', { id, password, username });
  return response.data;
};

// Flattened Upload
export const uploadProject = async (sessionId, files) => {
  const response = await api.post(`/session/upload?sessionId=${sessionId}`, files, { timeout: TIMEOUT.HEAVY });
  return response.data;
};

// Flattened Save
export const saveFile = async (sessionId, path, content = '') => {
  const response = await api.post('/session/save-file', { sessionId, path, content });
  return response.data;
};

// Flattened Delete
export const deleteFile = async (sessionId, path) => {
  const response = await api.delete(`/session/delete-file?sessionId=${sessionId}&path=${encodeURIComponent(path)}`);
  return response.data;
};

// Keep session lookup as is (GET /session/{id})
export const getSession = async (sessionId) => {
  const response = await api.get(`/session/${sessionId}`);
  return response.data;
};

// Fetch all files for a session (used for reconnecting after refresh)
export const getSessionFiles = async (sessionId) => {
  const response = await api.get(`/session/${sessionId}/files`);
  return response.data;
};

/* ---- Execution APIs ---- */

export const executeCode = async (sessionId, code, language = 'javascript') => {
  const response = await api.post('/execute', {
    sessionId,
    code,
    language,
  }, { timeout: TIMEOUT.LONG });
  return response.data;
};

/* ---- AI Diagnosis Configuration APIs ---- */

// Whether the backend has an OpenRouter key (env var, yml, or set at runtime)
export const getAiStatus = async () => {
  const response = await api.get('/ai/status');
  return response.data;
};

// Verify a key with OpenRouter and activate it on the backend (no restart needed)
export const saveAiKey = async (key) => {
  const response = await api.post('/ai/key', { key }, { timeout: TIMEOUT.AI });
  return response.data;
};

/* ---- Timeline APIs ---- */

export const getTimeline = async (sessionId) => {
  const response = await api.get(`/timeline/${sessionId}`);
  return response.data;
};

export const createSnapshot = async (sessionId, code, userId) => {
  const response = await api.post('/timeline/snapshot', {
    sessionId,
    code,
    userId,
  });
  return response.data;
};

/* ---- Deployment APIs ---- */

export const createDeployment = async (deploymentData) => {
  const response = await api.post('/deployments', deploymentData);
  return response.data;
};

export const getDeployments = async (sessionId) => {
  const response = await api.get(`/deployments?sessionId=${sessionId}`);
  return response.data;
};


/* ---- Root Cause APIs ---- */

export const analyzeRootCause = async (sessionId, error, code) => {
  const response = await api.post('/root-cause', {
    sessionId,
    error,
    code,
  }, { timeout: TIMEOUT.AI });
  return response.data;
};

/* ---- Git Workspace APIs ---- */

export const cloneGitRepo = async (sessionId, repoUrl) => {
  const response = await api.post('/git/clone', { sessionId, repoUrl }, { timeout: TIMEOUT.HEAVY });
  return response.data;
};

export const executeGitCommit = async (payload) => {
  // payload: { sessionId, message, files: [{ path, content }, ...] }
  const response = await api.post('/git/commit', payload, { timeout: TIMEOUT.LONG });
  return response.data;
};

export const gitPush = async (sessionId) => {
  const response = await api.post('/git/push', { sessionId }, { timeout: TIMEOUT.LONG });
  return response.data;
};

export const gitPull = async (sessionId) => {
  const response = await api.post('/git/pull', { sessionId }, { timeout: TIMEOUT.LONG });
  return response.data;
};

export const gitStatus = async (sessionId) => {
  const response = await api.get(`/git/status?sessionId=${sessionId}`);
  return response.data;
};

export const gitLog = async (sessionId, count = 10) => {
  const response = await api.get(`/git/log?sessionId=${sessionId}&count=${count}`);
  return response.data;
};

export const gitUndoCommit = async (sessionId) => {
  const response = await api.post('/git/undo-commit', { sessionId });
  return response.data;
};

export const gitBranches = async (sessionId) => {
  const response = await api.get(`/git/branches?sessionId=${sessionId}`);
  return response.data;
};

export const gitCheckout = async (sessionId, branch, create = false) => {
  const response = await api.post('/git/checkout', { sessionId, branch, create });
  return response.data;
};

export const gitIsConnected = async (sessionId) => {
  const response = await api.get(`/git/connected?sessionId=${sessionId}`);
  return response.data;
};

export const gitDisconnect = async (sessionId) => {
  const response = await api.post('/git/disconnect', { sessionId });
  return response.data;
};

/* ---- Project Context APIs ---- */

export const getProjectContext = async (projectId) => {
  const response = await api.get(`/context?projectId=${projectId}`);
  return response.data;
};

/* ---- Whiteboard APIs ---- */

export const getWhiteboard = async (projectId) => {
  const response = await api.get(`/whiteboard?projectId=${projectId}`);
  return response.data;
};

export const saveWhiteboard = async (projectId, boardData) => {
  const response = await api.put(`/whiteboard?projectId=${projectId}`, boardData);
  return response.data;
};

export default api;
