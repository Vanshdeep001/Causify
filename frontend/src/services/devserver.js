/* -------------------------------------------------------
 * devserver.js — API service for dev server management
 * ------------------------------------------------------- */

import api from './api';

/**
 * Detect project types in the current session
 */
export const detectProject = async (sessionId) => {
  const response = await api.post('/devserver/detect', { sessionId });
  return response.data;
};

/**
 * Start a dev server
 */
export const startDevServer = async (sessionId, directory, type) => {
  const response = await api.post('/devserver/start', { sessionId, directory, type });
  return response.data;
};

/**
 * Stop a dev server
 */
export const stopDevServer = async (sessionId, type) => {
  const response = await api.post('/devserver/stop', { sessionId, type });
  return response.data;
};

/**
 * Get status of all servers for a session
 */
export const getDevServerStatus = async (sessionId) => {
  const response = await api.get(`/devserver/status?sessionId=${sessionId}`);
  return response.data;
};

/**
 * Get logs for a specific server
 */
export const getDevServerLogs = async (sessionId, type) => {
  const response = await api.get(`/devserver/logs?sessionId=${sessionId}&type=${type}`);
  return response.data;
};
