/* -------------------------------------------------------
 * ipc/workspace.js — Local Project Workspace
 *
 * Disk-as-source-of-truth file access for a folder the user opened. Files are
 * read lazily and written straight back to their real location, so edits show up
 * in any other editor and never pass through the database.
 *
 * Every mutating operation is confined to a root the user explicitly opened.
 * The renderer supplies paths, so the checks here are the only thing standing
 * between a bug (or a malformed path) and the user's wider filesystem.
 * ------------------------------------------------------- */

const { ipcMain, app, dialog, BrowserWindow, shell } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/* ── Roots the user has opened this session ── */
// Only paths inside one of these may be read, written or deleted. Stored in
// canonical (symlink-resolved) form so a link inside the project cannot be used
// to step outside it.
const openRoots = new Set();

/* ── Exclusions ──
 * Mirrors the SKIP_DIRS list the renderer used for uploads: dependency, build
 * and tooling directories holding thousands of files nobody edits. Walking them
 * makes opening a project feel broken.
 */
const SKIP_DIRS = new Set([
  // JS / Node
  'node_modules', 'bower_components', '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache',
  // Python virtual envs & caches
  'venv', '.venv', 'site-packages', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.eggs',
  // Version control / IDE / editor metadata
  '.git', '.hg', '.svn', '.idea', '.vscode',
  // Build output & caches
  'dist', 'build', 'target', '.gradle', 'coverage', '.cache',
]);

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

const MAX_TEXT_SIZE = 1024 * 1024;       // 1 MB — source files
const MAX_ASSET_SIZE = 5 * 1024 * 1024;  // 5 MB — images / fonts
const MAX_ENTRIES = 20000;               // stop runaway walks of huge trees

const isBinaryPath = (p) => BINARY_EXTS.has(path.extname(p).toLowerCase());

/* ── Path confinement ── */

/**
 * Resolve a path and prove it lands inside an open root.
 *
 * A plain string prefix test is not enough: a symlink inside the project can
 * point anywhere, and `..` segments can climb out. We therefore canonicalise the
 * nearest existing ancestor (the target itself may not exist yet, as when
 * creating a file) and rebuild the path from there before comparing.
 *
 * Returns the canonical absolute path, or throws.
 */
function resolveInsideRoot(target) {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error('A file path is required');
  }
  if (target.includes('\0')) {
    throw new Error('Invalid file path');
  }

  const absolute = path.resolve(target);

  // Walk up to the nearest ancestor that exists, so we can canonicalise it.
  let existing = absolute;
  const trailing = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break; // reached the filesystem root
    trailing.unshift(path.basename(existing));
    existing = parent;
  }

  let canonical;
  try {
    canonical = path.join(fs.realpathSync(existing), ...trailing);
  } catch {
    canonical = absolute; // ancestor vanished mid-check — fall back to the literal path
  }

  for (const root of openRoots) {
    const rel = path.relative(root, canonical);
    if (rel === '') return canonical;                                  // the root itself
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return canonical; // inside it
  }

  throw new Error(
    'Refused: that path is outside the open project folder. ' +
    'Causify only writes inside the folder you opened.'
  );
}

/** Register a folder as writable for the rest of the session. */
function registerRoot(dir) {
  let canonical;
  try {
    canonical = fs.realpathSync(path.resolve(dir));
  } catch {
    canonical = path.resolve(dir);
  }
  openRoots.add(canonical);
  return canonical;
}

/* ── Directory walk ── */

/**
 * Collect every file in the project, skipping excluded directories and files too
 * large to edit. Returns relative POSIX-style paths — the renderer's file tree
 * and the rest of the app already speak that form.
 *
 * Contents are deliberately NOT read here. The whole point of local mode is that
 * opening a folder costs a directory listing, not a copy of the project.
 */
async function walkProject(root) {
  const files = [];
  let truncated = false;
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop();

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory (permissions) — skip rather than fail the open
    }

    for (const entry of entries) {
      if (files.length >= MAX_ENTRIES) {
        truncated = true;
        break;
      }

      const full = path.join(dir, entry.name);

      // Symlinked directories can form cycles and can point outside the project.
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;

      let size;
      try {
        size = (await fsp.stat(full)).size;
      } catch {
        continue;
      }

      const binary = isBinaryPath(entry.name);
      if (size > (binary ? MAX_ASSET_SIZE : MAX_TEXT_SIZE)) continue;

      files.push({
        path: path.relative(root, full).split(path.sep).join('/'),
        size,
        binary,
      });
    }

    if (truncated) break;
  }

  return { files, truncated };
}

/* ── Per-workspace state ──
 * History and whiteboard contents for a folder opened from disk. Kept in the
 * app's own data directory, in a file named after the project's path, so:
 *   • the user's project stays clean — nothing to gitignore, nothing in diffs
 *   • none of it goes near the database
 *   • reopening the same folder brings its history back
 */

function stateFileFor(root) {
  const digest = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 16);
  return path.join(app.getPath('userData'), 'workspace-state', `${digest}.json`);
}

function registerWorkspaceStateHandlers() {
  ipcMain.handle('workspace:state-load', async (_event, root) => {
    try {
      return JSON.parse(await fsp.readFile(stateFileFor(root), 'utf-8'));
    } catch {
      return null; // never opened before, or the file is unreadable
    }
  });

  ipcMain.handle('workspace:state-save', async (_event, root, state) => {
    try {
      const file = stateFileFor(root);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, JSON.stringify(state ?? {}), 'utf-8');
      return { saved: true };
    } catch (err) {
      // Losing history is not worth failing an edit over.
      console.error('[Workspace] Could not save workspace state:', err.message);
      return { saved: false, error: err.message };
    }
  });
}

/* ── IPC ── */

function registerWorkspaceHandlers() {
  registerWorkspaceStateHandlers();

  /**
   * Prompt for a folder, then return its file listing. The folder becomes a
   * writable root for the remainder of the session.
   */
  ipcMain.handle('workspace:open', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Open Project Folder',
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const root = registerRoot(result.filePaths[0]);
    const { files, truncated } = await walkProject(root);
    return { root, name: path.basename(root), files, truncated };
  });

  /**
   * Ask where to put a file and write it there.
   *
   * This is the "first save" of an untitled buffer, the same as any editor: the
   * file is created in the editor first and only acquires a location when saved.
   * The chosen folder becomes a writable root so later saves of the same file go
   * straight to disk without asking again.
   *
   * The folder is deliberately NOT adopted as the workspace — saving one loose
   * file should not replace whatever the user has open.
   */
  ipcMain.handle('workspace:save-as', async (_event, suggestedName, content) => {
    const win = BrowserWindow.getFocusedWindow();
    const picked = await dialog.showSaveDialog(win, {
      title: 'Save File',
      defaultPath: suggestedName || 'untitled.txt',
      buttonLabel: 'Save',
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (picked.canceled || !picked.filePath) return null;

    const target = picked.filePath;
    const parent = path.dirname(target);

    // The dialog allows typing a path through folders that do not exist yet, so
    // create them before registering the root — registerRoot resolves the real
    // path, which requires the directory to be there.
    await fsp.mkdir(parent, { recursive: true });
    registerRoot(parent);

    await fsp.writeFile(resolveInsideRoot(target), content == null ? '' : String(content), 'utf-8');

    return { filePath: target, fileName: path.basename(target), directory: parent };
  });

  /**
   * Re-open a folder by path, without a dialog — used to restore the previously
   * open project when the app starts. Returns null if it is gone, so the caller
   * can quietly fall back rather than showing an error.
   */
  ipcMain.handle('workspace:reopen', async (_event, dirPath) => {
    try {
      if (!dirPath || !fs.statSync(dirPath).isDirectory()) return null;
    } catch {
      return null; // moved or deleted since last run
    }
    const root = registerRoot(dirPath);
    const { files, truncated } = await walkProject(root);
    return { root, name: path.basename(root), files, truncated };
  });

  /**
   * Ask for a destination folder and write a received project into it.
   *
   * This is how someone joining a session ends up with the project on their own
   * machine rather than only in the browser's memory: from here on their disk is
   * the source of truth, exactly as it is for the person who shared it.
   *
   * A non-empty folder is confirmed first — this writes real files into a place
   * the user chose, and silently merging into an existing project would be a
   * nasty surprise.
   */
  ipcMain.handle('workspace:materialize', async (_event, files) => {
    const win = BrowserWindow.getFocusedWindow();
    const picked = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose a folder for the shared project',
      buttonLabel: 'Save Here',
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;

    const root = registerRoot(picked.filePaths[0]);

    const existing = await fsp.readdir(root).catch(() => []);
    if (existing.length > 0) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Cancel', 'Write Here Anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'Folder is not empty',
        message: `${path.basename(root)} already contains files.`,
        detail: `${root}\n\nFiles from the session with the same names will be overwritten.`,
      });
      if (response !== 1) return null;
    }

    let written = 0;
    for (const [relative, content] of Object.entries(files || {})) {
      try {
        const target = resolveInsideRoot(path.join(root, relative.split('/').join(path.sep)));
        await fsp.mkdir(path.dirname(target), { recursive: true });

        // Binary assets travel as base64 data URLs; write them back as bytes so
        // images and fonts are real files, not text.
        const marker = typeof content === 'string' && content.startsWith('data:')
          ? content.indexOf(';base64,')
          : -1;
        if (marker >= 0) {
          await fsp.writeFile(target, Buffer.from(content.slice(marker + 8), 'base64'));
        } else {
          await fsp.writeFile(target, content == null ? '' : String(content), 'utf-8');
        }
        written++;
      } catch (err) {
        console.error(`[Workspace] Could not write ${relative}: ${err.message}`);
      }
    }

    const { files: listing, truncated } = await walkProject(root);
    return { root, name: path.basename(root), files: listing, truncated, written };
  });

  /**
   * Read the whole project as { path: content }.
   *
   * Used when starting a collaboration session from an open folder: the peers
   * need the actual contents, not just the listing.
   */
  ipcMain.handle('workspace:read-all', async (_event, root) => {
    const safeRoot = resolveInsideRoot(root);
    return readProjectFiles(safeRoot);
  });

  /** Refresh the file listing for an already-open project. */
  ipcMain.handle('workspace:list', async (_event, root) => {
    const safeRoot = resolveInsideRoot(root);
    return walkProject(safeRoot);
  });

  /**
   * Read one file. Text comes back as a UTF-8 string; images and fonts come back
   * as a base64 data URL so they can be previewed.
   */
  ipcMain.handle('workspace:read', async (_event, filePath) => {
    const safe = resolveInsideRoot(filePath);

    if (isBinaryPath(safe)) {
      const buffer = await fsp.readFile(safe);
      const ext = path.extname(safe).toLowerCase().slice(1);
      const mime = ext === 'svg' ? 'image/svg+xml'
        : ['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext) ? `font/${ext}`
        : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      return { content: `data:${mime};base64,${buffer.toString('base64')}`, binary: true };
    }

    return { content: await fsp.readFile(safe, 'utf-8'), binary: false };
  });

  /**
   * Write a file, creating parent directories as needed. This is the single
   * audited path through which every editor save reaches the disk.
   */
  ipcMain.handle('workspace:write', async (_event, filePath, content) => {
    const safe = resolveInsideRoot(filePath);
    await fsp.mkdir(path.dirname(safe), { recursive: true });
    await fsp.writeFile(safe, content == null ? '' : String(content), 'utf-8');
    return { path: safe };
  });

  /** Create an empty file or a directory. Refuses to overwrite an existing file. */
  ipcMain.handle('workspace:create', async (_event, targetPath, isFolder) => {
    const safe = resolveInsideRoot(targetPath);

    if (fs.existsSync(safe)) {
      throw new Error(`${path.basename(safe)} already exists`);
    }

    if (isFolder) {
      await fsp.mkdir(safe, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(safe), { recursive: true });
      await fsp.writeFile(safe, '', 'utf-8');
    }
    return { path: safe };
  });

  /**
   * Delete a file or folder after an explicit confirmation.
   *
   * Deletion goes to the OS recycle bin rather than being unlinked outright:
   * this now removes the user's real files, and a misclick should be
   * recoverable through the mechanism they already know. If the shell refuses
   * (some network paths), we fall back to a permanent delete.
   */
  ipcMain.handle('workspace:delete', async (_event, targetPath) => {
    const safe = resolveInsideRoot(targetPath);
    if (!fs.existsSync(safe)) return { deleted: false, reason: 'missing' };

    const isDir = fs.statSync(safe).isDirectory();
    const win = BrowserWindow.getFocusedWindow();
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', isDir ? 'Delete Folder' : 'Delete File'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirm delete',
      message: `Delete ${path.basename(safe)}?`,
      detail: `${safe}\n\nThis removes it from your disk. It will be moved to the recycle bin.`,
    });

    if (response !== 1) return { deleted: false, reason: 'cancelled' };

    try {
      await shell.trashItem(safe);
    } catch {
      await fsp.rm(safe, { recursive: true, force: true });
    }
    return { deleted: true };
  });

  /** Rename / move within the project. Both ends are confinement-checked. */
  ipcMain.handle('workspace:rename', async (_event, fromPath, toPath) => {
    const from = resolveInsideRoot(fromPath);
    const to = resolveInsideRoot(toPath);
    if (fs.existsSync(to)) throw new Error(`${path.basename(to)} already exists`);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
    return { path: to };
  });
}

/**
 * Read an entire project off disk as a { relativePath: content } map.
 *
 * Used by features that need a snapshot of the whole project rather than lazy
 * per-file access — deploy, for instance, which materialises a build workspace.
 * Applies the same exclusions and size caps as the walk above.
 */
async function readProjectFiles(root) {
  const canonicalRoot = registerRoot(root);
  const { files } = await walkProject(canonicalRoot);
  const result = {};

  for (const entry of files) {
    const full = path.join(canonicalRoot, entry.path.split('/').join(path.sep));
    try {
      if (entry.binary) {
        // Base64 data URL — the same representation sessions use for binary
        // assets, so anything downstream treats both sources identically.
        const ext = path.extname(full).toLowerCase().slice(1);
        const mime = ['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)
          ? `font/${ext}`
          : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        result[entry.path] = `data:${mime};base64,${(await fsp.readFile(full)).toString('base64')}`;
      } else {
        result[entry.path] = await fsp.readFile(full, 'utf-8');
      }
    } catch {
      // Unreadable file — skip it rather than failing the whole read.
    }
  }
  return result;
}

module.exports = {
  registerWorkspaceHandlers,
  readProjectFiles,
  // exported for tests
  _internals: { resolveInsideRoot, registerRoot, openRoots, walkProject },
};
