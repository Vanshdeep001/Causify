/* -------------------------------------------------------
 * gitRepoMemory.js — Per-project GitHub repo persistence
 *
 * Remembers the repo URL a user connected for a given
 * project base, so reopening the same project never asks
 * for the repo details again. Stored in localStorage,
 * keyed by the project's root folder (or session name).
 * ------------------------------------------------------- */

const STORAGE_KEY = 'causify-git-repos';

const readAll = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
};

const writeAll = (map) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('[Causify] Could not save git repo details:', e.message);
  }
};

/**
 * Derive a stable identity for the current project base.
 * Prefers the shared root folder of the loaded files (stable across
 * sessions for the same uploaded project), falling back to the
 * session/project name.
 */
export const getProjectKey = (files, sessionName, workspaceRoot) => {
  /* A folder opened from disk has a real, stable identity: its path. Falling
   * through to the heuristics below would key it off an arbitrary file name,
   * so two different projects could collide and the same project could change
   * key as files are added. */
  if (workspaceRoot) return `dir:${workspaceRoot}`;

  const paths = Object.keys(files || {});
  const roots = new Set(
    paths.filter((p) => p.includes('/')).map((p) => p.split('/')[0])
  );
  if (roots.size === 1) return `root:${[...roots][0]}`;
  if (sessionName) return `name:${sessionName}`;
  if (paths.length > 0) return `file:${paths[0]}`;
  return null;
};

/** Get the saved repo URL for a project, or null. */
export const getSavedRepoUrl = (projectKey) => {
  if (!projectKey) return null;
  return readAll()[projectKey]?.url || null;
};

/** Save the repo URL (as entered, so it can re-clone) for a project. */
export const saveRepoUrl = (projectKey, url) => {
  if (!projectKey || !url) return;
  const map = readAll();
  map[projectKey] = { url, savedAt: new Date().toISOString() };
  writeAll(map);
};

/** Forget the saved repo for a project (explicit disconnect). */
export const clearSavedRepoUrl = (projectKey) => {
  if (!projectKey) return;
  const map = readAll();
  if (map[projectKey]) {
    delete map[projectKey];
    writeAll(map);
  }
};
