/* -------------------------------------------------------
 * devserver.js — API service for dev server management
 *
 * Every call takes a "scope": the absolute folder path when the project was
 * opened from disk (local mode), or the session id otherwise. Passing
 * projectPath tells the backend to run directly in the user's folder rather
 * than materialising files out of the database.
 *
 * Servers are keyed by whichever scope started them, so status and logs use the
 * same value in both modes and need no branching.
 * ------------------------------------------------------- */

import api from './api';

/**
 * Detect project types — in a locally opened folder, or in the current session.
 */
export const detectProject = async (scope, { local = false } = {}) => {
  const body = local ? { projectPath: scope } : { sessionId: scope };
  const response = await api.post('/devserver/detect', body);
  return response.data;
};

/**
 * Start a dev server
 */
export const startDevServer = async (scope, directory, type, { local = false } = {}) => {
  const body = local
    ? { projectPath: scope, directory, type }
    : { sessionId: scope, directory, type };
  const response = await api.post('/devserver/start', body);
  return response.data;
};

/**
 * Stop a dev server
 */
export const stopDevServer = async (scope, type, { local = false } = {}) => {
  const body = local ? { projectPath: scope, type } : { sessionId: scope, type };
  const response = await api.post('/devserver/stop', body);
  return response.data;
};

/**
 * Get status of all servers for a scope
 */
export const getDevServerStatus = async (scope) => {
  const response = await api.get(`/devserver/status?sessionId=${encodeURIComponent(scope)}`);
  return response.data;
};

/**
 * Get logs for a specific server
 */
export const getDevServerLogs = async (scope, type) => {
  const response = await api.get(
    `/devserver/logs?sessionId=${encodeURIComponent(scope)}&type=${type}`
  );
  return response.data;
};
