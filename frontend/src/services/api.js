/* -------------------------------------------------------
 * api.js — API Service Layer
 * 
 * Handles all HTTP communication with the Spring Boot backend.
 * Uses Axios with a base URL configured for the dev proxy.
 * ------------------------------------------------------- */

import axios from 'axios';

// Create an Axios instance with defaults
const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000, // 30 seconds (code execution can take time)
});

/* ---- Session APIs ---- */

// Create a new debugging session
export const createSession = async (name, username, password) => {
  const response = await api.post('/session/create', { name, username, password });
  return response.data;
};

// Join an existing session
export const joinSession = async (id, password) => {
  const response = await api.post('/session/join', { id, password });
  return response.data;
};

// Upload project files
export const uploadProject = async (sessionId, files) => {
  const response = await api.post(`/session/${sessionId}/upload`, files);
  return response.data;
};

// Get session details by ID
export const getSession = async (sessionId) => {
  const response = await api.get(`/session/${sessionId}`);
  return response.data;
};

/* ---- Execution APIs ---- */

// Execute code and get output + root cause analysis
export const executeCode = async (sessionId, code, language = 'javascript') => {
  const response = await api.post('/execute', {
    sessionId,
    code,
    language,
  });
  return response.data;
};

/* ---- Timeline APIs ---- */

// Get all snapshots for a session (timeline history)
export const getTimeline = async (sessionId) => {
  const response = await api.get(`/timeline/${sessionId}`);
  return response.data;
};

// Create a manual snapshot
export const createSnapshot = async (sessionId, code, userId) => {
  const response = await api.post('/timeline/snapshot', {
    sessionId,
    code,
    userId,
  });
  return response.data;
};

/* ---- Root Cause APIs ---- */

// Request root cause analysis for a specific error
export const analyzeRootCause = async (sessionId, error, code) => {
  const response = await api.post('/root-cause', {
    sessionId,
    error,
    code,
  });
  return response.data;
};

export default api;
