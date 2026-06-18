/* -------------------------------------------------------
 * codeShotDeepLink.js — Deep-Link Generator & Parser
 *
 * Pure utility functions for building and parsing
 * causify:// protocol URIs used by CodeShots.
 *
 * Format:
 *   causify://open?project={id}&file={path}&start={n}&end={m}&node={nodeId}
 *
 * - project : session / project ID (required)
 * - file    : relative file path   (required)
 * - start   : start line number    (required)
 * - end     : end line number      (required)
 * - node    : graph node ID        (optional)
 * ------------------------------------------------------- */

/**
 * Build a causify:// deep-link string.
 *
 * @param {Object} params
 * @param {string} params.projectId  - Session / project ID
 * @param {string} params.filePath   - Relative file path
 * @param {number} params.startLine  - Start line (1-indexed)
 * @param {number} params.endLine    - End line (1-indexed)
 * @param {string} [params.nodeId]   - Optional graph node ID
 * @returns {string} The causify:// URI
 */
export function buildCodeShotLink({ projectId, filePath, startLine, endLine, nodeId }) {
  if (!projectId || !filePath || !startLine || !endLine) {
    throw new Error('[CodeShot] buildCodeShotLink: missing required parameters');
  }

  const params = new URLSearchParams();
  params.set('project', projectId);
  params.set('file', filePath);
  params.set('start', String(startLine));
  params.set('end', String(endLine));

  if (nodeId) {
    params.set('node', nodeId);
  }

  return `causify://open?${params.toString()}`;
}

/**
 * Parse a causify:// deep-link URL into its constituent parts.
 *
 * @param {string} url - The causify:// URI string
 * @returns {{ projectId: string, filePath: string, startLine: number, endLine: number, nodeId: string|null } | null}
 *   Parsed parameters, or null if the URL is invalid.
 */
export function parseCodeShotLink(url) {
  if (!url || typeof url !== 'string') return null;

  try {
    // URLSearchParams can't parse custom protocols directly,
    // so we extract the query string after the '?'
    const qIndex = url.indexOf('?');
    if (qIndex === -1) return null;

    const params = new URLSearchParams(url.substring(qIndex + 1));

    const projectId = params.get('project');
    const filePath = params.get('file');
    const startRaw = params.get('start');
    const endRaw = params.get('end');
    const nodeId = params.get('node') || null;

    if (!projectId || !filePath || !startRaw || !endRaw) return null;

    const startLine = parseInt(startRaw, 10);
    const endLine = parseInt(endRaw, 10);

    if (isNaN(startLine) || isNaN(endLine) || startLine < 1 || endLine < startLine) {
      return null;
    }

    return { projectId, filePath, startLine, endLine, nodeId };
  } catch {
    return null;
  }
}
