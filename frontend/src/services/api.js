/* -------------------------------------------------------
 * api.js — API Service Layer
 * ------------------------------------------------------- */

import axios from 'axios';

// Create an Axios instance with defaults
const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000, 
});

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
  const response = await api.post(`/session/upload?sessionId=${sessionId}`, files);
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
  });
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

/* ---- Root Cause APIs ---- */

export const analyzeRootCause = async (sessionId, error, code) => {
  const response = await api.post('/root-cause', {
    sessionId,
    error,
    code,
  });
  return response.data;
};

/* ---- Git Workspace APIs ---- */

export const cloneGitRepo = async (sessionId, repoUrl) => {
  const response = await api.post('/git/clone', { sessionId, repoUrl });
  return response.data;
};

export const executeGitCommit = async (payload) => {
  // payload: { sessionId, message, files: [{ path, content }, ...] }
  const response = await api.post('/git/commit', payload);
  return response.data;
};

export const gitPush = async (sessionId) => {
  const response = await api.post('/git/push', { sessionId });
  return response.data;
};

export const gitPull = async (sessionId) => {
  const response = await api.post('/git/pull', { sessionId });
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

export const gitIsConnected = async (sessionId) => {
  const response = await api.get(`/git/connected?sessionId=${sessionId}`);
  return response.data;
};

export const gitDisconnect = async (sessionId) => {
  const response = await api.post('/git/disconnect', { sessionId });
  return response.data;
};

export default api;
