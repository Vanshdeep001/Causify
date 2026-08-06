/* -------------------------------------------------------
 * api.js — API Service Layer
 * ------------------------------------------------------- */

import axios from 'axios';
import { getApiBase } from './backendHost';

// Create an Axios instance with defaults
const api = axios.create({
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000, // default: fine for quick CRUD (save, status, lookups)
});

// Where the backend lives is resolved per request, not once at import.
//
// It used to be a module constant pinned to 127.0.0.1, which meant a joiner's
// app could only ever reach the backend on the joiner's own machine — the
// reason two people on two laptops could never share a session. Setting it
// here keeps every call site untouched while letting the origin change when
// someone joins a session hosted elsewhere.
api.interceptors.request.use((config) => {
  config.baseURL = getApiBase();
  return config;
});

// Some operations are inherently slow and must not share the 30s CRUD deadline,
// or they abort mid-flight with "timeout of 30000ms exceeded":
//   HEAVY — large uploads and git clone (lots of data / full network fetch)
//   LONG  — git push/pull/commit and code execution
//   AI    — LLM round-trips (root-cause, key verification)
/* AGENT is deliberately the longest. The auto-fix agent makes up to three
 * propose → patch → execute cycles in one request, each capped at 90s for the
 * model plus 10s for the run, so its true ceiling is ~300s. At the 120s AI
 * deadline a slow multi-attempt run was being aborted by the client while the
 * backend was still working — the user saw a network error and every attempt
 * already made was thrown away. */
const TIMEOUT = { HEAVY: 300000, LONG: 120000, AI: 120000, AGENT: 310000 };

// If the local database becomes unusable, every request fails and Axios reports
// only its generic "Request failed with status code 500", which tells the user
// nothing about the remedy. The backend flags that one specific unrecoverable
// state; surface its message so the UI can explain it. Deliberately narrow —
// all other failures keep exactly the message they had before.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const data = error?.response?.data;
    if (data?.error === 'DATABASE_UNAVAILABLE' && data.message) {
      error.message = data.message;
    }
    return Promise.reject(error);
  }
);

/* ---- Session APIs ---- */

export const createSession = async (name, username, password) => {
  const response = await api.post('/session/create', { name, username, password });
  return response.data;
};

export const joinSession = async (id, password, username) => {
  const response = await api.post('/session/join', { id, password, username });
  return response.data;
};

// Leaving is what lets the backend delete the session once everybody is gone —
// a session carries files between collaborators, it is not storage.
export const leaveSession = async (sessionId, userId) => {
  const response = await api.post('/session/leave', { sessionId, userId });
  return response.data;
};

// Signals that a session is still in use, so the retention sweep skips it.
export const touchSession = async (sessionId) => {
  const response = await api.post(`/session/${sessionId}/touch`);
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

// Whether a provider is configured, and which one
export const getAiStatus = async () => {
  const response = await api.get('/ai/status');
  return response.data;
};

// The providers this build supports, with their default models and key hints
export const getAiProviders = async () => {
  const response = await api.get('/ai/providers');
  return response.data;
};

// Guess the provider from a pasted key so the form can pre-select it.
// Advisory only — an unrecognised key is not an error.
export const detectAiProvider = async (key) => {
  const response = await api.post('/ai/detect', { key });
  return response.data;
};

/* Verify a key with a real generation call and activate it (no restart needed).
 * `provider` blank means "detect it from the key". `model` blank means the
 * provider's default. `baseUrl` is only read for the custom provider. */
// Forget the active key on the backend. On desktop the caller should also
// clear the OS keychain copy, or it would be re-injected on the next launch.
export const clearAiKey = async () => {
  const response = await api.delete('/ai/key');
  return response.data;
};

export const saveAiKey = async (key, { provider = '', model = '', baseUrl = '' } = {}) => {
  const response = await api.post(
    '/ai/key',
    { key, provider, model, baseUrl },
    { timeout: TIMEOUT.AI }
  );
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

/* ---- Auto-Fix Agent APIs ----
 * The agent may run several propose → patch → execute cycles before it answers,
 * so this shares the long AI deadline rather than the 30s CRUD one.
 */

export const requestAutoFix = async (payload) => {
  // payload: { sessionId, code, language, filePath, errorType, errorMessage,
  //            errorLine, suspectedVariable, semanticContext }
  const response = await api.post('/auto-fix', payload, { timeout: TIMEOUT.AGENT });
  return response.data;
};

/* ---- Git Workspace APIs ----
 * The `sessionId` argument is really a scope: a session id for a cloned sandbox,
 * or the absolute folder path when the user opened a project from disk, in which
 * case the backend runs git against that repository in place. Paths contain
 * separators, colons and spaces, so query parameters must be encoded.
 */

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
  const response = await api.get(`/git/status?sessionId=${encodeURIComponent(sessionId)}`);
  return response.data;
};

export const gitLog = async (sessionId, count = 10) => {
  const response = await api.get(
    `/git/log?sessionId=${encodeURIComponent(sessionId)}&count=${count}`
  );
  return response.data;
};

export const gitUndoCommit = async (sessionId) => {
  const response = await api.post('/git/undo-commit', { sessionId });
  return response.data;
};

export const gitBranches = async (sessionId) => {
  const response = await api.get(`/git/branches?sessionId=${encodeURIComponent(sessionId)}`);
  return response.data;
};

export const gitCheckout = async (sessionId, branch, create = false) => {
  const response = await api.post('/git/checkout', { sessionId, branch, create });
  return response.data;
};

export const gitIsConnected = async (sessionId) => {
  const response = await api.get(`/git/connected?sessionId=${encodeURIComponent(sessionId)}`);
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
