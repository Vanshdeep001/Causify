/* -------------------------------------------------------
 * fileSave.js — File System Access API Service
 *
 * Provides native OS Save / Save As dialogs using the
 * browser's File System Access API (showSaveFilePicker).
 * Falls back to Blob+download for Firefox/Safari.
 * ------------------------------------------------------- */

/**
 * Check if the File System Access API is supported.
 */
export const isFileSystemAccessSupported = () =>
  typeof window !== 'undefined' && 'showSaveFilePicker' in window;

/**
 * Build file-type filter list for the Save dialog.
 * The filter matching the current file extension is placed first.
 */
export const getFileTypeFilters = (extension) => {
  const allFilters = [
    { description: 'JavaScript',  accept: { 'text/javascript': ['.js'] } },
    { description: 'JSX',         accept: { 'text/javascript': ['.jsx'] } },
    { description: 'TypeScript',  accept: { 'text/typescript': ['.ts', '.tsx'] } },
    { description: 'CSS',         accept: { 'text/css': ['.css'] } },
    { description: 'HTML',        accept: { 'text/html': ['.html', '.htm'] } },
    { description: 'JSON',        accept: { 'application/json': ['.json'] } },
    { description: 'Python',      accept: { 'text/x-python': ['.py', '.pyw'] } },
    { description: 'Java',        accept: { 'text/x-java': ['.java'] } },
    { description: 'C/C++',       accept: { 'text/x-c': ['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp'] } },
    { description: 'Markdown',    accept: { 'text/markdown': ['.md', '.mdx'] } },
  ];

  const ext = extension?.toLowerCase();

  // Move the matching filter to the front
  if (ext) {
    const matchIdx = allFilters.findIndex((f) =>
      Object.values(f.accept).flat().includes(ext)
    );
    if (matchIdx > 0) {
      const [match] = allFilters.splice(matchIdx, 1);
      allFilters.unshift(match);
    }
  }

  return allFilters;
};

/**
 * Extract the file extension from a filename (e.g. ".js").
 */
const getExtension = (filename) => {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.substring(dot) : '';
};

/**
 * Open the native OS "Save As" dialog and write content to disk.
 *
 * @param {string} filename     - Suggested filename (e.g. "index.js")
 * @param {string} content      - File content string
 * @returns {Promise<{ handle: FileSystemFileHandle, name: string } | null>}
 *   Returns the handle + chosen name, or null if cancelled / unsupported.
 */
export const saveFileAs = async (filename, content) => {
  if (isFileSystemAccessSupported()) {
    try {
      const ext = getExtension(filename);
      const handle = await window.showSaveFilePicker({
        suggestedName: filename || 'untitled.js',
        types: getFileTypeFilters(ext),
      });

      // Write content
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();

      return { handle, name: handle.name };
    } catch (err) {
      if (err.name === 'AbortError') {
        // User cancelled — this is fine
        return null;
      }
      console.error('[Causify] Save As failed:', err);
      throw err;
    }
  }

  // ── Fallback: Blob download ──
  try {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'untitled.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { handle: null, name: filename };
  } catch (err) {
    console.error('[Causify] Fallback download failed:', err);
    throw err;
  }
};

/**
 * Silently write content to an existing FileSystemFileHandle.
 * (No dialog — reuses the previously chosen location.)
 *
 * @param {FileSystemFileHandle} handle
 * @param {string} content
 * @returns {Promise<boolean>} true on success
 */
export const saveFileToHandle = async (handle, content) => {
  if (!handle) return false;
  try {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch (err) {
    console.error('[Causify] Silent save failed:', err);
    // Handle might have been invalidated (e.g. tab refresh) — caller
    // should fall back to Save As.
    return false;
  }
};
