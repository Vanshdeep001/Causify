/* -------------------------------------------------------
 * gitStatusMap.js — Turn `git status --porcelain` into file decorations
 *
 * Gives the file explorer the same at-a-glance signal an editor does: which
 * files you have changed, which are new, which are gone — without opening the
 * git panel to find out.
 * ------------------------------------------------------- */

/** What a decorated entry means. Ordered by how much it should draw the eye. */
export const GIT_DECORATION = {
  conflict: { letter: '!', color: '#E5484D', label: 'Conflicting' },
  deleted: { letter: 'D', color: '#E5484D', label: 'Deleted' },
  untracked: { letter: 'U', color: '#3DD68C', label: 'Untracked' },
  added: { letter: 'A', color: '#3DD68C', label: 'Added' },
  renamed: { letter: 'R', color: '#8B8DFF', label: 'Renamed' },
  modified: { letter: 'M', color: '#FFB224', label: 'Modified' },
};

/* Which state wins when a folder contains several. A folder showing "modified"
 * while hiding a conflict inside it would be actively misleading, so the more
 * urgent state is the one that surfaces. */
const SEVERITY = ['conflict', 'deleted', 'renamed', 'modified', 'added', 'untracked'];

/**
 * Classify one porcelain XY code.
 *
 * X is the index, Y the working tree. Both matter: a file staged as added and
 * then edited is still "modified" to the user, and any pair containing U — or
 * the AA/DD pairs — is a merge conflict.
 */
const classify = (xy) => {
  const x = xy[0] || ' ';
  const y = xy[1] || ' ';

  if (xy === '??') return 'untracked';
  if (x === 'U' || y === 'U' || xy === 'AA' || xy === 'DD') return 'conflict';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'R') return 'renamed';
  if (x === 'M' || y === 'M' || x === 'T' || y === 'T') return 'modified';
  if (x === 'A') return 'added';
  return null;
};

/**
 * Parse porcelain output into { path: state }.
 *
 * Only the file entries are read — the `## branch` header is not one. Renames
 * arrive as "old -> new"; the new path is what exists to be decorated.
 */
export const parseGitStatus = (porcelain) => {
  const map = {};
  if (!porcelain) return map;

  for (const raw of String(porcelain).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.startsWith('##')) continue;

    const xy = line.slice(0, 2);
    const state = classify(xy);
    if (!state) continue;

    // git quotes paths containing spaces or non-ASCII characters.
    let path = line.slice(3).trim().replace(/^"|"$/g, '');
    const arrow = path.indexOf(' -> ');
    if (arrow >= 0) path = path.slice(arrow + 4).replace(/^"|"$/g, '');

    // Directory entries end in "/" and stand for everything beneath them.
    map[path.replace(/\/$/, '')] = state;
  }

  return map;
};

/**
 * The state to show for a path, folders included.
 *
 * A folder takes the most urgent state of anything inside it, which is what
 * makes a change visible in a collapsed tree instead of hiding until expanded.
 */
export const decorationFor = (path, statusMap, isFolder) => {
  if (!path || !statusMap) return null;

  if (!isFolder) {
    const state = statusMap[path];
    return state ? { state, ...GIT_DECORATION[state] } : null;
  }

  const prefix = path + '/';
  let best = null;
  for (const [candidate, state] of Object.entries(statusMap)) {
    if (candidate !== path && !candidate.startsWith(prefix)) continue;
    if (best === null || SEVERITY.indexOf(state) < SEVERITY.indexOf(best)) best = state;
  }

  return best ? { state: best, ...GIT_DECORATION[best] } : null;
};
