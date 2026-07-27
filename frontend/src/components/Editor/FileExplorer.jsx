/* -------------------------------------------------------
 * FileExplorer.jsx — Sidebar with Session + File Management
 * ------------------------------------------------------- */

import React, { useState, useRef, useEffect } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { createSession, joinSession, leaveSession, uploadProject, saveFile, deleteFile, getSessionFiles } from '../../services/api';
import { connectWebSocket, sendCodeChange, sendFileDelete, sendProjectSync } from '../../services/socket';
import { detectProject } from '../../services/devserver';
import { isBinaryAssetPath, isSkippedAssetPath } from '../../utils/binaryAssets';
import MarioLoader from '../common/MarioLoader';

const ActionButton = ({ onClick, title, children }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        border: 'none',
        color: hovered ? '#FFFFFF' : 'var(--t3)',
        cursor: 'pointer',
        padding: '6px 9px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.12s ease',
        flexShrink: 0
      }}
    >
      {children}
    </button>
  );
};

const FileExplorer = ({ onToggle }) => {
  const files = useEditorStore((s) => s.files);
  const activePath = useEditorStore((s) => s.activePath);
  const openFile = useEditorStore((s) => s.openFile);
  const sessionId = useEditorStore((s) => s.sessionId);
  const sessionName = useEditorStore((s) => s.sessionName);
  const currentUser = useEditorStore((s) => s.currentUser);
  const userRole = useEditorStore((s) => s.userRole);
  const connectedUsers = useEditorStore((s) => s.connectedUsers);

  // Owner and editor collaborators may create/upload/delete; viewers may not.
  const canEdit = userRole === 'owner'
    || connectedUsers.find((u) => u.id === currentUser?.id)?.permission !== 'viewer';

  const setSession = useEditorStore((s) => s.setSession);
  const setCurrentUser = useEditorStore((s) => s.setCurrentUser);
  const setUserRole = useEditorStore((s) => s.setUserRole);
  const setProject = useEditorStore((s) => s.setProject);
  const setConnectedUsers = useEditorStore((s) => s.setConnectedUsers);
  const addSnapshot = useEditorStore((s) => s.addSnapshot);
  const handleExecutionResult = useEditorStore((s) => s.handleExecutionResult);
  const updateRemoteFile = useEditorStore((s) => s.updateRemoteFile);
  const fileActivity = useEditorStore((s) => s.fileActivity);
  const filePresence = useEditorStore((s) => s.filePresence);
  const resetSession = useEditorStore((s) => s.resetSession);
  const addFile = useEditorStore((s) => s.addFile);
  const removeFile = useEditorStore((s) => s.removeFile);
  const impactWarnings = useEditorStore((s) => s.impactWarnings);
  const setDetectedProjects = useEditorStore((s) => s.setDetectedProjects);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const setTerminalOpen = useEditorStore((s) => s.setTerminalOpen);
  const setProjectRootPath = useEditorStore((s) => s.setProjectRootPath);

  // Local workspace — set when a folder was opened from disk rather than uploaded.
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const workspaceName = useEditorStore((s) => s.workspaceName);
  const openLocalWorkspace = useEditorStore((s) => s.openLocalWorkspace);
  const closeLocalWorkspace = useEditorStore((s) => s.closeLocalWorkspace);
  const absolutePathFor = useEditorStore((s) => s.absolutePathFor);
  const canOpenLocalFolder = typeof window !== 'undefined' && Boolean(window.electronAPI?.workspace);

  const pendingExplorerAction = useEditorStore((s) => s.pendingExplorerAction);
  const clearPendingExplorerAction = useEditorStore((s) => s.clearPendingExplorerAction);

  // Welcome-screen requests (the Mario block's power-ups) land here:
  // run the matching explorer flow once, then clear. Deferred via a
  // cancellable timeout so StrictMode's throwaway first mount can't
  // consume the action — only the surviving mount executes it.
  useEffect(() => {
    if (!pendingExplorerAction) return;
    const timer = setTimeout(() => {
      if (pendingExplorerAction === 'import-project') {
        openProjectFolder();
      } else if (pendingExplorerAction === 'new-file') {
        startNewFile();
      }
      clearPendingExplorerAction();
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingExplorerAction, clearPendingExplorerAction]);

  // Compute set of file paths that are affected by active impacts
  const affectedPaths = new Set();
  impactWarnings.forEach(w => {
    if (w.affectedFiles) w.affectedFiles.forEach(f => affectedPaths.add(f));
    if (w.impacts) w.impacts.forEach(i => { if (i.file) affectedPaths.add(i.file); });
  });

  const inlineActionBtnSty = { background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', opacity: 0.7, transition: 'opacity 0.2s, color 0.2s' };

  // UI state
  const [panel, setPanel] = useState(null); // null | 'create' | 'join'
  const [projName, setProjName] = useState('My Project');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('User ' + Math.floor(Math.random() * 1000));
  const [joinId, setJoinId] = useState('');
  const [joinPwd, setJoinPwd] = useState('');
  const [joinUsername, setJoinUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [newItem, setNewItem] = useState(null); // { type: 'file'|'folder', parent: '', name: '' }
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const [modifier, setModifier] = useState('Alt+');
  useEffect(() => {
    const isMac = typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || '');
    setModifier(isMac ? '⌥' : 'Alt+');
  }, []);

  useEffect(() => {
    const handleExplorerShortcuts = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.altKey && !sessionId) {
        const key = e.key.toLowerCase();
        if (key === 'n') {
          e.preventDefault();
          setPanel('create');
        } else if (key === 'j') {
          e.preventDefault();
          setPanel('join');
        } else if (key === 'i') {
          e.preventDefault();
          openProjectFolder();
        } else if (key === 'f') {
          e.preventDefault();
          startNewFile();
        }
      }
    };
    window.addEventListener('keydown', handleExplorerShortcuts);
    return () => window.removeEventListener('keydown', handleExplorerShortcuts);
  }, [sessionId]);

  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const LoadingOverlay = () => (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--s0)', zIndex: 1000,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px', textAlign: 'center'
    }}>
      {/* ── BOLD TYPOGRAPHY ── */}
      <div style={{
        fontFamily: 'var(--font-header)',
        fontSize: '0.85rem',
        fontWeight: 900,
        letterSpacing: '-0.02em',
        textTransform: 'uppercase',
        color: '#FFFFFF',
        lineHeight: 1
      }}>
        <span>Index</span>
        <span style={{ color: 'transparent', WebkitTextStroke: '1px rgba(255,255,255,0.7)', textStroke: '1px rgba(255,255,255,0.7)' }}>ing</span>
      </div>

      {/* ── PROGRESS BAR ── */}
      <div style={{
        width: '100%',
        maxWidth: '160px',
        marginTop: '20px',
        fontFamily: 'var(--font-number)',
        fontSize: '0.55rem',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--t3)', letterSpacing: '0.08em' }}>
          <span>PROGRESS</span>
          <span style={{ color: '#FFFFFF', fontWeight: 600 }}>74%</span>
        </div>
        <div style={{
          height: '4px',
          width: '100%',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--line)',
          borderRadius: '2px',
          overflow: 'hidden',
          position: 'relative'
        }}>
          <div style={{
            height: '100%',
            width: '74%',
            background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.4), #FFFFFF)',
            boxShadow: '0 0 8px rgba(255, 255, 255, 0.6)',
            borderRadius: '2px'
          }} />
        </div>
      </div>
    </div>
  );

  const initSocket = (sessId, user) => {
    connectWebSocket(sessId, user, {
      onCodeChange: (d) => {
        const currentU = useEditorStore.getState().currentUser;
        const isOwnChange = d.userId === currentU?.id;
        updateRemoteFile(d.path, d.code, isOwnChange ? null : d.userId);
      },
      onUsersChange: (d) => setConnectedUsers(d.users || []),
      onExecutionResult: (d) => handleExecutionResult(d),
      onSnapshot: (d) => addSnapshot(d),
      onCursorUpdate: (d) => {
        const currentU = useEditorStore.getState().currentUser;
        if (d.userId !== currentU?.id) {
          if (d.onWhiteboard) {
            if (window.onWhiteboardCursorMessage) window.onWhiteboardCursorMessage(d);
          } else {
            useEditorStore.getState().updateRemoteCursor(d.userId, d);
          }
        }
      },
      onPresenceUpdate: (d) => {
        const currentU = useEditorStore.getState().currentUser;
        if (d.userId !== currentU?.id) useEditorStore.getState().updateFilePresence(d.userId, d);
      },
      onFileDelete: (d) => {
        const currentU = useEditorStore.getState().currentUser;
        if (d.userId !== currentU?.id) useEditorStore.getState().removeFile(d.path);
      },
      // A peer uploaded a project into the session. The files arrived over REST,
      // so there are no per-file events to apply — re-read the list instead.
      onProjectSync: async (d) => {
        const state = useEditorStore.getState();
        if (d?.userId === state.currentUser?.id) return; // our own upload
        if (!state.sessionId) return;
        try {
          const files = await getSessionFiles(state.sessionId);
          useEditorStore.getState().mergeRemoteFiles(files);
        } catch (err) {
          console.warn('[Causify] Could not load the shared project:', err.message);
        }
      },
      onWhiteboardChange: (d) => {
        if (window.onWhiteboardSocketMessage) window.onWhiteboardSocketMessage(d);
      },
      onRevert: (d) => {
        const currentU = useEditorStore.getState().currentUser;
        if (d.revertedUser === currentU?.username || d.revertedUser === currentU?.id) {
          useEditorStore.getState().setRevertNotification({
            username: d.username,
            path: d.path,
            reason: 'cross-file impact',
          });
        }
      },
      onConnected: () => {
        console.log('[Causify] Connected to Collab');
        useEditorStore.getState().loadSessionHistory(sessId);
      },
    });
  };

  const handleCreate = async (uploadedFiles = []) => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      // Starting a session from an open folder means "share what I'm working
      // on": read the project off disk so peers receive the real contents. The
      // folder stays the source of truth — the session is only the transport.
      let filesToShare = uploadedFiles;
      if (filesToShare.length === 0 && workspaceRoot && window.electronAPI?.workspace?.readAll) {
        try {
          const contents = await window.electronAPI.workspace.readAll(workspaceRoot);
          filesToShare = Object.entries(contents).map(([path, content]) => ({ path, content }));
        } catch (err) {
          console.warn('[Causify] Could not read the folder to share it:', err.message);
        }
      }

      const session = await createSession(projName, username, password || '0000');
      // Remembered so a restored workspace can re-create its session
      // under the same identity after the window is closed and reopened.
      try { localStorage.setItem('causify-last-username', username); } catch { /* best effort */ }
      if (filesToShare.length > 0) {
        await uploadProject(session.id, filesToShare);
      }
      setSession(session.id, session.name);
      setCurrentUser(session.user);
      setUserRole('owner');
      // Keep a local workspace as it is: the files are already on disk and the
      // tree is already correct. Replacing it would drop the disk connection.
      if (!workspaceRoot) setProject(filesToShare);
      initSocket(session.id, session.user);
      setPanel(null);
      return session.id;
    } catch (err) {
      setErrorMsg(err.message || 'Creation failed');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoin = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const session = await joinSession(joinId, joinPwd, joinUsername);
      try { localStorage.setItem('causify-last-username', joinUsername); } catch { /* best effort */ }

      // On the desktop, put the shared project on the joiner's own disk and work
      // from there. Both sides then edit real files, and the session is only the
      // channel between them — which is what lets it be deleted afterwards.
      let landedOnDisk = false;
      const incoming = session.files || [];
      if (canOpenLocalFolder && incoming.length > 0) {
        try {
          const asMap = Object.fromEntries(incoming.map((f) => [f.path, f.content]));
          const placed = await window.electronAPI.workspace.materialize(asMap);
          if (placed) {
            openLocalWorkspace(placed);
            landedOnDisk = true;
          }
        } catch (err) {
          console.warn('[Causify] Could not write the shared project to disk:', err.message);
        }
      }

      setSession(session.id, session.name);
      setCurrentUser(session.user);
      setUserRole('collaborator');
      // If the files went to disk the tree already reflects them; loading the
      // in-memory copy over the top would sever the disk connection.
      if (!landedOnDisk) setProject(incoming);
      initSocket(session.id, session.user);
      setPanel(null);
    } catch (err) {
      setErrorMsg(err.message || 'Join failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Per-file size caps. Images can be larger than source files but must still be
  // bounded so a session doesn't balloon the DB / websocket sync.
  const MAX_TEXT_SIZE = 1024 * 1024;        // 1 MB for source/text files
  const MAX_ASSET_SIZE = 5 * 1024 * 1024;   // 5 MB for images/fonts

  // Dependency, build-output and tooling directories that hold thousands of
  // files no one edits. Importing them bloats the session and slows the app.
  // 'site-packages' is the key one for Python: it catches every virtualenv's
  // packages no matter what the env folder is named (venv, .venv, env, …).
  const SKIP_DIRS = [
    // JS / Node
    'node_modules', 'bower_components', '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache',
    // Python virtual envs & caches
    'venv', '.venv', 'site-packages', '__pycache__',
    '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.eggs',
    // Version control / IDE / editor metadata
    '.git', '.hg', '.svn', '.idea', '.vscode',
    // Build output & caches
    'dist', 'build', 'target', '.gradle', 'coverage', '.cache',
  ];

  const shouldUploadFile = (file) => {
    const path = file.webkitRelativePath || file.name;

    // Skip heavy/irrelevant binaries (media, archives, executables, lockfiles).
    // Images and fonts are NOT skipped — they're carried in as base64 so the dev
    // server can resolve `import logo from './logo.png'` style asset imports.
    if (isSkippedAssetPath(path)) return false;

    // Skip files in excluded directories
    if (SKIP_DIRS.some(dir => path.includes(`/${dir}/`) || path.includes(`\\${dir}\\`))) return false;

    // Size cap: larger allowance for binary assets, tighter for text/source.
    const maxSize = isBinaryAssetPath(path) ? MAX_ASSET_SIZE : MAX_TEXT_SIZE;
    if (file.size > maxSize) return false;

    return true;
  };

  const readAndProcess = (allFiles) => {
    const projectFiles = [];
    let processed = 0;
    if (allFiles.length === 0) return;
    
    setIsUploading(true);
    allFiles.forEach((file) => {
      const path = file.webkitRelativePath || file.name;
      const reader = new FileReader();
      reader.onload = (event) => {
        projectFiles.push({ path, content: event.target.result });
        processed++;
        if (processed === allFiles.length) {
          const afterUpload = (sid) => {
            // Auto-detect project type after upload
            if (sid) {
              setTimeout(() => {
                detectProject(sid).then((result) => {
                  if (result?.projects?.length > 0) {
                    setDetectedProjects(result.projects);
                  }
                }).catch(() => { /* detection is best-effort */ });
              }, 500);
            }
          };

          if (sessionId) {
            uploadProject(sessionId, projectFiles)
              .then(() => {
                setProject(projectFiles);
                // Tell everyone else the file list changed. Without this the
                // upload is invisible to them — it goes over REST, so no edit
                // events are produced and they keep waiting for files that
                // have already arrived.
                if (currentUser) sendProjectSync(sessionId, currentUser.id);
                afterUpload(sessionId);
              })
              .finally(() => setIsUploading(false));
          } else if (canOpenLocalFolder) {
            // Desktop: never mint a session behind the user's back. Sessions are
            // for collaboration and are created only from New Session / Join.
            setErrorMsg('OPEN A FOLDER FIRST — or start a session to share these files.');
            setIsUploading(false);
          } else {
            // Browser has no filesystem access, so a session is the only place
            // these files can live.
            handleCreate(projectFiles)
              .then((sid) => {
                if (sid) afterUpload(sid);
              })
              .finally(() => setIsUploading(false));
          }
        }
      };
      // Images/fonts → base64 data URL (decoded to real bytes on the server);
      // everything else → text.
      if (isBinaryAssetPath(path)) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
  };

  const handleFolderUpload = (e) => {
    const allFiles = Array.from(e.target.files);

    // Desktop app: remember the imported folder's real disk path so
    // integrated terminals open directly inside the project.
    const first = allFiles[0];
    if (first?.webkitRelativePath && window.electronAPI?.getPathForFile) {
      try {
        const abs = window.electronAPI.getPathForFile(first);
        const rel = first.webkitRelativePath;
        // abs ends with rel (same length, OS separators) — strip it to get
        // the parent dir, then re-append the project folder name.
        if (abs && abs.length > rel.length) {
          const parentDir = abs.slice(0, abs.length - rel.length);
          setProjectRootPath(parentDir + rel.split('/')[0]);
        }
      } catch { /* browser mode — terminal falls back to the home dir */ }
    }

    const filesArray = allFiles.filter(shouldUploadFile);
    if (filesArray.length > 0) readAndProcess(filesArray);
  };

  const handleFileUpload = (e) => {
    const filesArray = Array.from(e.target.files).filter(f => f.size < 1024 * 1024);
    if (filesArray.length > 0) readAndProcess(filesArray);
  };

  /**
   * Open a folder from disk in local mode: files are read from and written back
   * to their real location, so no session is created and nothing is copied into
   * the database. Electron only — the browser has no filesystem access.
   */
  const handleOpenLocalFolder = async () => {
    const api = window.electronAPI?.workspace;
    if (!api) return;

    setIsUploading(true);
    setErrorMsg('');
    try {
      const result = await api.open();
      if (!result) return; // cancelled

      openLocalWorkspace(result);
      if (result.truncated) {
        setErrorMsg(`LARGE PROJECT: showing the first ${result.files.length} files.`);
      }
    } catch (err) {
      setErrorMsg(`COULD NOT OPEN FOLDER: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Take the shared project out of the session and onto this machine.
   *
   * A collaborator can join a project that exists nowhere on their own disk.
   * On the desktop the files are written into a folder they choose, which also
   * switches them into local mode so they are editing real files from then on.
   * In the browser there is no filesystem, so the project comes down as a zip.
   */
  const handleSaveProjectLocally = async () => {
    const store = useEditorStore.getState();
    const entries = Object.entries(store.files || {});
    if (entries.length === 0) {
      setErrorMsg('NOTHING TO SAVE YET — the project has no files.');
      return;
    }

    setIsUploading(true);
    setErrorMsg('');
    try {
      if (canOpenLocalFolder) {
        const placed = await window.electronAPI.workspace.materialize(Object.fromEntries(entries));
        if (!placed) return; // cancelled the folder picker
        openLocalWorkspace(placed);
        setErrorMsg(`SAVED ${placed.written} FILE(S) TO ${placed.root}`);
        return;
      }

      const { createZip, downloadBlob } = await import('../../utils/zip');
      const name = (store.sessionName || 'causify-project')
        .trim().replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'causify-project';
      downloadBlob(
        createZip(entries.map(([path, content]) => ({ path, content }))),
        `${name}.zip`
      );
    } catch (err) {
      setErrorMsg(`COULD NOT SAVE PROJECT: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Leave whatever is currently open.
   *
   * Telling the backend we left is what allows it to delete the session once the
   * last person is gone. A local workspace survives this — the files are on disk
   * and leaving a collaboration is not a reason to close the folder.
   */
  const handleDisconnect = async () => {
    const { sessionId: activeSession, currentUser: user } = useEditorStore.getState();

    if (activeSession) {
      try {
        await leaveSession(activeSession, user?.id);
      } catch (err) {
        // Best effort — the backend's sweep collects anything left behind.
        console.warn('[Causify] Could not notify the backend on leave:', err.message);
      }
      resetSession();
      return;
    }

    closeLocalWorkspace();
  };

  /**
   * The single entry point for "open a project folder".
   *
   * On the desktop this opens the folder in place: files are read from and
   * written back to their real location, and no session is created. The browser
   * has no filesystem access, so it falls back to the upload input, which copies
   * the project into a session as before.
   */
  const openProjectFolder = () => {
    if (canOpenLocalFolder) handleOpenLocalFolder();
    else folderInputRef.current?.click();
  };

  /** "New file", from wherever it is triggered — name it inline, as before. */
  const startNewFile = () => setNewItem({ type: 'file', parent: '', name: '' });

  const handleCreateNew = async (e) => {
    if (e.key === 'Escape') { setNewItem(null); return; }
    if (e.key === 'Enter') {
      const name = e.target.value.trim();
      if (!name) { setNewItem(null); return; }

      const parentPath = newItem.parent;
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      const isFolder = newItem.type === 'folder';
      const pathToSave = isFolder ? `${fullPath}/.keep` : fullPath;

      // Local mode: create it on disk. No session, no upload — the file exists
      // where the user expects it and is visible to every other editor at once.
      if (workspaceRoot) {
        try {
          const target = absolutePathFor(isFolder ? fullPath : pathToSave);
          await window.electronAPI.workspace.create(target, isFolder);
          // For a folder this registers its .keep placeholder, which is what
          // keeps an otherwise empty directory visible in the tree.
          addFile(pathToSave, '');
          setNewItem(null);
          setErrorMsg('');
        } catch (err) {
          setErrorMsg(`COULD NOT CREATE: ${err.message}`);
          setNewItem(null);
        }
        return;
      }

      if (!sessionId) {
        // Desktop with no folder open: make an untitled buffer, exactly as any
        // editor does. It lives in memory until the first save asks where to put
        // it — no session invented to hold it, and no dialog before there is
        // anything to write.
        if (canOpenLocalFolder) {
          addFile(pathToSave, '');
          setNewItem(null);
          setErrorMsg('');
          return;
        }
        // Browser: no filesystem, so the session is the only available storage.
        handleCreate([{ path: pathToSave, content: '' }]);
        setNewItem(null);
        return;
      }

      try {
        await saveFile(sessionId, pathToSave, '');
        addFile(pathToSave, '');
        if (currentUser) {
          sendCodeChange(sessionId, currentUser.id, pathToSave, '');
        }
        setNewItem(null);
        setErrorMsg('');
      } catch (err) {
        if (err.response?.status === 404) {
          setErrorMsg('SESSION EXPIRED: Please start/join a new session.');
          resetSession();
        } else {
          const msg = err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to create item';
          setErrorMsg(`SERVER ERROR: ${msg}`);
        }
      }
    }
  };

  const handleDelete = async (path, isFolder) => {
    // Check if the file has unsaved changes
    const isDirty = !isFolder && useEditorStore.getState().isFileDirty(path);

    // Local mode deletes the user's real file, so the main process runs its own
    // confirmation and sends it to the recycle bin. Only the unsaved-changes
    // warning is worth adding on top; a second generic prompt would be noise.
    if (workspaceRoot) {
      if (isDirty && !window.confirm(
        `"${path.split('/').pop()}" has unsaved changes.\n\nClick OK to continue, or Cancel to go back.`
      )) return;

      try {
        const result = await window.electronAPI.workspace.remove(absolutePathFor(path));
        if (result?.deleted) removeFile(path);
      } catch (err) {
        setErrorMsg(`COULD NOT DELETE: ${err.message}`);
      }
      return;
    }

    if (isDirty) {
      // Three-way dialog: Save / Don't Save / Cancel
      const choice = window.confirm(
        `"${path.split('/').pop()}" has unsaved changes.\n\nClick OK to delete anyway, or Cancel to go back.`
      );
      if (!choice) return; // Cancel
    } else {
      if (!window.confirm(`Delete ${isFolder ? 'folder' : 'file'} "${path}"?`)) return;
    }

    try {
      await deleteFile(sessionId, path);
      removeFile(path);
      // Tell the other collaborators to drop it from their tree too.
      if (sessionId && currentUser) sendFileDelete(sessionId, currentUser.id, path);
    } catch (err) {
      setErrorMsg('Failed to delete item');
    }
  };

  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const expandedInitRef = useRef(false);

  const toggleFolder = (path) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // ── Minimal technical line-art icons ──
  const FileIcon = ({ name, isFolder, isOpen, size = 16 }) => {
    if (isFolder) {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transition: 'all 0.2s ease' }}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z" stroke={isOpen ? "#FFFFFF" : "#A0A0A0"} strokeWidth="2" strokeLinejoin="round" fill={isOpen ? "rgba(255,255,255,0.06)" : "none"} />
        </svg>
      );
    }

    const ext = name.split('.').pop()?.toLowerCase();

    switch (ext) {
      case 'html':
      case 'htm':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 2L4.67 19.34L12 21.38L19.33 19.34L21 2H3Z" fill="#E34F26"/>
            <path d="M12 3.66V19.46L17.5 17.9L18.8 4.7L12 3.66Z" fill="#F06529"/>
            <path d="M12 8.78H8.84L9 10.3H12V8.78ZM12 11.8H9.15L9.5 15.35L12 16.05V11.8Z" fill="#EBEBEB"/>
            <path d="M12 8.78V10.3H15.04L14.75 13.3L12 14.05V15.58L14.6 14.86L15.3 7H12V8.78Z" fill="#FFFFFF"/>
          </svg>
        );
      case 'css':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 2L4.67 19.34L12 21.38L19.33 19.34L21 2H3Z" fill="#1572B6"/>
            <path d="M12 3.66V19.46L17.5 17.9L18.8 4.7L12 3.66Z" fill="#33A9DC"/>
            <path d="M12 8.78H7.32L7.6 11.8H12V8.78ZM12 14.8L9.5 14.12L9.36 12.6H6.3L6.58 15.8L12 17.3V14.8Z" fill="#EBEBEB"/>
            <path d="M12 8.78V11.8H14.7L14.4 14.8L12 15.48V17.3L17.42 15.8L18.1 8H12V8.78Z" fill="#FFFFFF"/>
          </svg>
        );
      case 'js':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#F7DF1E"/>
            <path d="M18.86 16.92C18.43 17.9 17.53 18.52 16.27 18.52C14.78 18.52 13.78 17.55 13.78 15.32H15.15C15.15 16.73 15.68 17.39 16.3 17.39C16.9 17.39 17.39 17.06 17.39 16.03V10.15H18.86V16.92ZM11.16 16.9C10.79 17.86 9.87 18.52 8.44 18.52C6.88 18.52 5.92 17.45 5.92 15.32H7.29C7.29 16.85 7.84 17.39 8.46 17.39C9.07 17.39 9.5 17.02 9.5 16.38C9.5 15.65 9.17 15.28 8.1 14.8L7.13 14.37C5.9 13.82 5.25 13.06 5.25 11.66C5.25 9.77 6.64 8.78 8.35 8.78C9.9 8.78 10.86 9.68 11.16 11.23H9.8C9.62 10.36 9.15 9.9 8.41 9.9C7.8 9.9 7.37 10.27 7.37 10.87C7.37 11.45 7.69 11.77 8.52 12.13L9.5 12.56C11.05 13.24 11.83 14.07 11.83 15.54C11.83 15.56 11.83 15.58 11.83 15.6V15.63C11.83 15.65 11.83 15.66 11.83 15.68C11.75 16.14 11.53 16.56 11.16 16.9Z" fill="#000000"/>
          </svg>
        );
      case 'ts':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#3178C6"/>
            <path d="M12.92 18.52H14.39V10.15H18.86V8.78H8.44V10.15H12.92V18.52ZM7.78 12.55C6.9 12.16 6.3 11.75 6.3 10.87C6.3 10.27 6.73 9.9 7.33 9.9C7.94 9.9 8.4 10.36 8.58 11.23H9.95C9.65 9.68 8.68 8.78 7.14 8.78C5.43 8.78 4.04 9.77 4.04 11.66C4.04 13.06 4.7 13.82 5.92 14.37L6.89 14.8C7.96 15.28 8.29 15.65 8.29 16.38C8.29 17.02 7.86 17.39 7.25 17.39C6.63 17.39 6.08 16.85 6.08 15.32H4.7C4.7 17.55 5.7 18.52 7.2 18.52C8.63 18.52 9.55 17.86 9.92 16.9C10.29 15.94 10.62 15.54 9.62 15.08L8.64 14.65C8.3 14.5 8.01 14.37 7.78 12.55Z" fill="#FFFFFF"/>
          </svg>
        );
      case 'jsx':
      case 'tsx':
        return (
          <svg width={size} height={size} viewBox="-11.5 -10.23174 23 20.46348" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="0" cy="0" r="2.05" fill="#61DAFB"/>
            <g stroke="#61DAFB" strokeWidth="1.2" fill="none">
              <ellipse rx="11" ry="4.2"/>
              <ellipse rx="11" ry="4.2" transform="rotate(60)"/>
              <ellipse rx="11" ry="4.2" transform="rotate(120)"/>
            </g>
          </svg>
        );
      case 'json':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#2F2F2F" stroke="#4F4F4F" strokeWidth="1"/>
            <path d="M9 7C9 5.34 10.34 4 12 4V5.5C11.17 5.5 10.5 6.17 10.5 7V10C10.5 10.83 9.83 11.5 9 11.5C9.83 11.5 10.5 12.17 10.5 13V16C10.5 16.83 11.17 17.5 12 17.5V19C10.34 19 9 17.66 9 16V13C9 12.72 8.78 12.5 8.5 12.5H7.5V11.5H8.5C8.78 11.5 9 11.28 9 11V7Z" fill="#3DD68C"/>
            <path d="M15 7C15 5.34 13.66 4 12 4V5.5C12.83 5.5 13.5 6.17 13.5 7V10C13.5 10.83 14.17 11.5 15 11.5C14.17 11.5 13.5 12.17 13.5 13V16C13.5 16.83 12.83 17.5 12 17.5V19C13.66 19 15 17.66 15 16V13C15 12.72 15.22 12.5 15.5 12.5H16.5V11.5H15.5C15.22 11.5 15 11.28 15 11V7Z" fill="#3DD68C"/>
          </svg>
        );
      case 'md':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#0A0A0A" stroke="#EDEDED" strokeWidth="1"/>
            <path d="M4 7H6V11L8 8L10 11V7H12V15H10L8 12L6 15H4V7Z" fill="#FFFFFF"/>
            <path d="M17 7V11H19.5L16.5 15L13.5 11H16V7H17Z" fill="#FFFFFF"/>
          </svg>
        );
      case 'py':
      case 'pyw':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.14 2C9.57 2 7.78 3.57 7.78 5.75V7.4H12.2V8.04H6V11.96C6 14.14 7.78 15.71 10.35 15.71H11.75V14.06C11.75 11.88 13.53 10.31 16.1 10.31H20.3V5.75C20.3 3.57 18.52 2 15.95 2H12.14ZM10.5 4.5C10.91 4.5 11.25 4.84 11.25 5.25C11.25 5.66 10.91 6 10.5 6C10.09 6 9.75 5.66 9.75 5.25C9.75 4.84 10.09 4.5 10.5 4.5Z" fill="#3776AB"/>
            <path d="M11.86 22C14.43 22 16.22 20.43 16.22 18.25V16.6H11.8V15.96H18V12.04C18 9.86 16.22 8.29 13.65 8.29H12.25V9.94C12.25 12.12 10.47 13.69 7.9 13.69H3.7V18.25C3.7 20.43 5.48 22 8.05 22H11.86ZM13.5 19.5C13.09 19.5 12.75 19.16 12.75 18.75C12.75 18.34 13.09 18 13.5 18C13.91 18 14.25 18.34 14.25 18.75C14.25 19.16 13.91 19.5 13.5 19.5Z" fill="#FFE873"/>
          </svg>
        );
      case 'cpp':
      case 'cc':
      case 'cxx':
      case 'hpp':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#00599C"/>
            <path d="M11 7.5H7.5V16.5H11" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 10V14M13 12H17" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M19 10V14M17 12H21" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        );
      case 'c':
      case 'h':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#659AD2"/>
            <path d="M15 7.5H9.5V16.5H15" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        );
      case 'java':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#EA2D2E"/>
            <path d="M7 10H15L14 18H8L7 10Z" fill="#FFFFFF"/>
            <path d="M15 11C16.5 11 17.5 12 17.5 13.5C17.5 15 16.5 16 15 16" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M9 5C9 7 10 7 10 9M12 4C12 6 13 6 13 8" stroke="#FFFFFF" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        );
      default:
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#C8C8C8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
        );
    }
  };

  // Auto-expand all folders on first load (moved out of render to avoid infinite loop)
  useEffect(() => {
    const allPaths = Object.keys(files);
    if (!expandedInitRef.current && allPaths.length > 0) {
      expandedInitRef.current = true;
      const initialExpanded = new Set();
      allPaths.forEach(p => {
        const parts = p.split('/');
        let cur = '';
        for (let i = 0; i < parts.length - 1; i++) {
          cur = cur ? `${cur}/${parts[i]}` : parts[i];
          initialExpanded.add(cur);
        }
      });
      setExpandedPaths(initialExpanded);
    }
  }, [files]);

  const buildTree = (filesObj) => {
    const tree = {};
    // Hide the same heavy dependency/build dirs we skip on import, plus OS cruft.
    // Guards older sessions whose files were uploaded before the skip list grew.
    const hiddenEntries = new Set([...SKIP_DIRS, '.DS_Store']);
    const allPaths = Object.keys(filesObj);

    allPaths.forEach((path) => {
      if (path.split('/').some(p => hiddenEntries.has(p))) return;
      const parts = path.split('/');
      let current = tree;
      parts.forEach((part, index) => {
        if (!current[part]) current[part] = index === parts.length - 1 ? null : {};
        current = current[part];
      });
    });
    return tree;
  };

  const tree = buildTree(files);

  const FileItem = ({ name, path, isFolder }) => {
    const isActive = activePath === path;
    const activeEditor = fileActivity[path];
    const isAffected = affectedPaths.has(path);
    const [isHovered, setIsHovered] = useState(false);

    // Users (other than me) currently working in this file.
    const presentUsers = isFolder ? [] : Object.entries(filePresence)
      .filter(([uid, p]) => p.path === path && uid !== currentUser?.id)
      .map(([uid, p]) => ({ uid, ...p }));

    const extension = name.includes('.') ? name.split('.').pop().toUpperCase() : '';
    const nameOnly = name.includes('.') ? name.substring(0, name.lastIndexOf('.')) : name;

    return (
      <div
        className="fx-file-item"
        onClick={(e) => {
          e.stopPropagation();
          if (isFolder) toggleFolder(path);
          else openFile(path);
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title={path}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 10px',
          cursor: 'pointer',
          transition: 'all 0.12s ease',
          position: 'relative',
          background: isActive ? 'var(--lime-dim)' : isHovered ? 'rgba(255, 255, 255, 0.02)' : 'transparent',
          borderRadius: '4px',
          margin: '1px 6px'
        }}
      >
        {/* Active state thin left border notch */}
        {isActive && (
          <div style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            width: '2px',
            height: '14px',
            background: 'var(--lime)'
          }} />
        )}

        {isFolder && (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={isActive || isHovered ? "var(--t1)" : "var(--t4)"} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.15s', transform: expandedPaths.has(path) ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0, marginRight: '2px' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
          {isFolder ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
              <FileIcon name={name} isFolder={true} isOpen={expandedPaths.has(path)} size={13} />
              <span style={{
                fontFamily: 'var(--font-header)',
                fontWeight: 800,
                fontSize: '0.64rem',
                color: isActive ? '#FFFFFF' : isHovered ? 'var(--t1)' : 'var(--t2)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: '0.01em',
                textTransform: 'uppercase'
              }}>
                {name}
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
              <FileIcon name={name} isFolder={false} size={13} />
              <span style={{
                fontFamily: 'var(--font-header)',
                fontWeight: 800,
                fontSize: '0.64rem',
                color: isActive ? '#FFFFFF' : isHovered ? 'var(--t1)' : 'var(--t2)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: '-0.01em'
              }}>
                {nameOnly}
              </span>
              {extension && (
                <span style={{
                  fontFamily: 'var(--font-number)',
                  fontSize: '0.45rem',
                  color: isActive ? 'var(--cyan)' : 'var(--t3)',
                  fontWeight: 800,
                  letterSpacing: '0.05em',
                  background: isActive ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  flexShrink: 0
                }}>
                  {extension}
                </span>
              )}
            </div>
          )}
        </div>

        {isAffected && !isFolder && (
          <div title="Affected by recent change" style={{ width: '5px', height: '5px', background: 'var(--amber)', borderRadius: '50%', animation: 'hud-pulse 1.4s infinite' }} />
        )}

        {/* Presence: who is currently working in this file */}
        {presentUsers.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
            title={`${presentUsers.map((u) => u.username).join(', ')} working here`}>
            {presentUsers.slice(0, 3).map((u, i) => (
              <div key={u.uid} style={{
                width: '14px', height: '14px', borderRadius: '3px',
                background: u.color || '#6366f1',
                border: '1px solid var(--s1)',
                marginLeft: i === 0 ? 0 : '-4px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.42rem', fontWeight: 800, color: '#0A0A0A',
                fontFamily: 'var(--font-number)',
                boxShadow: `0 0 5px ${u.color || '#6366f1'}66`,
              }}>
                {(u.username || '?').charAt(0).toUpperCase()}
              </div>
            ))}
            {presentUsers.length > 3 && (
              <span style={{
                marginLeft: '3px', fontSize: '0.42rem', color: 'var(--t3)',
                fontFamily: 'var(--font-number)', fontWeight: 700,
              }}>+{presentUsers.length - 3}</span>
            )}
          </div>
        )}

        {activeEditor && !isFolder && (
          <div style={{
            padding: '1px 3px', fontSize: '0.4rem', fontFamily: 'var(--font-number)',
            background: 'var(--cyan-dim)', border: '1px solid var(--cyan-line)',
            borderRadius: '2px', color: 'var(--cyan)', letterSpacing: '0.08em',
            fontWeight: 600
          }}>
            LIVE
          </div>
        )}

        {/* Delete — owner & editor collaborators only. Visibility is CSS-driven
            (revealed on row :hover) so it survives parent re-renders. */}
        {canEdit && (
          <button
            className="fx-file-del"
            onClick={(e) => { e.stopPropagation(); handleDelete(path, isFolder); }}
            title={`Delete ${isFolder ? 'folder' : 'file'}`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '18px', height: '18px', flexShrink: 0,
              background: 'transparent', border: 'none', borderRadius: '3px',
              color: 'var(--t3)', cursor: 'pointer', padding: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--crimson)'; e.currentTarget.style.background = 'rgba(232,17,35,0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        )}
      </div>
    );
  };

  const renderTree = (node, name = '', currentPath = '', depth = 0) => {
    const path = currentPath ? (name ? `${currentPath}/${name}` : currentPath) : name;
    const isFolder = node !== null;
    const isExpanded = depth === 0 || expandedPaths.has(path);
    
    // Highlight lines if this item is selected
    const activePath = useEditorStore.getState().activePath;
    const isActive = activePath === path;

    return (
      <div key={path} style={{
        marginLeft: depth > 0 ? '16px' : '0',
        position: 'relative'
      }}>
        {/* Tree connector lines */}
        {depth > 0 && (
           <div style={{
              position: 'absolute',
              left: '-10px',
              top: '-10px',
              bottom: isFolder ? 'calc(100% - 15px)' : '50%',
              width: '1px',
              background: isActive ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)',
              transition: 'background 0.15s ease'
           }} />
        )}
        {depth > 0 && (
           <div style={{
              position: 'absolute',
              left: '-10px',
              top: '50%',
              width: '10px',
              height: '1px',
              background: isActive ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)',
              transition: 'background 0.15s ease'
           }} />
        )}

        {/* Creative Elbow Joint Dot */}
        {depth > 0 && (
           <div style={{
              position: 'absolute',
              left: '-11px',
              top: 'calc(50% - 1px)',
              width: '3px',
              height: '3px',
              borderRadius: '50%',
              background: isActive ? '#FFFFFF' : 'var(--line-strong)',
              boxShadow: isActive ? '0 0 6px #FFFFFF' : 'none',
              transition: 'all 0.15s ease'
           }} />
        )}

        {isFolder ? (
          <>
            {name && <FileItem name={name} path={path} isFolder={true} />}
            {isExpanded && (
              <div style={{ marginLeft: name ? '4px' : '0' }}>
                {newItem && newItem.parent === path && name && (
                  <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '5px' }}>
                    <FileIcon name={newItem.name || 'new'} isFolder={newItem.type === 'folder'} />
                    <input autoFocus onKeyDown={handleCreateNew} onBlur={() => setNewItem(null)} style={{ ...inputStyle, marginBottom: 0, height: '24px', flex: 1, border: 'none', background: 'transparent' }} placeholder={newItem.type === 'folder' ? 'DIR' : 'FILE'} />
                  </div>
                )}
                {Object.entries(node)
                  .sort(([aName, aNode], [bName, bNode]) => {
                    const aIsFolder = aNode !== null;
                    const bIsFolder = bNode !== null;
                    if (aIsFolder && !bIsFolder) return -1;
                    if (!aIsFolder && bIsFolder) return 1;
                    return aName.localeCompare(bName);
                  })
                  .map(([childName, childNode]) => renderTree(childNode, childName, path, depth + 1))}
              </div>
            )}
          </>
        ) : (
          <FileItem name={name} path={path} isFolder={false} />
        )}
      </div>
    );
  };

  const sectionLabelSty = {
    fontSize: '0.54rem',
    fontWeight: 700,
    color: 'var(--t3)',
    marginBottom: '14px',
    letterSpacing: '0.08em',
    fontFamily: 'var(--font-header)',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  };

  const inputStyle = {
    width: '100%',
    height: '34px',
    padding: '0 10px',
    background: 'var(--s0)',
    border: '1px solid var(--line-strong)',
    borderRadius: '4px',
    color: 'var(--t1)',
    fontSize: '0.74rem',
    outline: 'none',
    marginBottom: '12px',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
    fontFamily: 'var(--font-body)',
    fontWeight: 500,
  };


  const btnStyle = (isPrimary) => ({
    width: '100%',
    height: '34px',
    border: `1px solid ${isPrimary ? '#FFFFFF' : 'var(--line-strong)'}`,
    background: isPrimary ? '#FFFFFF' : 'var(--s2)',
    color: isPrimary ? '#0A0A0A' : 'var(--t1)',
    fontFamily: 'var(--font-body)',
    fontWeight: 600,
    fontSize: '0.72rem',
    cursor: 'pointer',
    marginBottom: '6px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'background 0.15s ease',
    letterSpacing: '0.01em',
    position: 'relative',
    overflow: 'hidden'
  });

  const explorerActionBtnSty = { background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: '6px', borderRadius: '4px', display: 'flex', alignItems: 'center', transition: 'all 0.15s' };

  const labelStyle = { 
    fontSize: '0.54rem', 
    color: 'var(--t3)', 
    fontFamily: 'var(--font-number)', 
    fontWeight: 600,
    letterSpacing: '0.08em', 
    textTransform: 'uppercase',
    display: 'block',
    marginBottom: '6px'
  };

  const backBtnStyle = { background: 'none', border: 'none', color: 'var(--t3)', fontSize: '0.64rem', fontFamily: 'var(--font-body)', cursor: 'pointer', width: '100%', marginTop: '6px' };

  const primaryActionSty = {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    padding: '12px 14px',
    background: hoveredIndex === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.015)',
    color: 'var(--t1)',
    border: `1px solid ${hoveredIndex === 0 ? 'rgba(255,255,255,0.2)' : 'var(--line-strong)'}`,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background 0.15s ease, border-color 0.15s ease',
  };

  const secondaryActionSty = (index) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    padding: '10px 12px',
    background: hoveredIndex === index ? 'rgba(255,255,255,0.04)' : 'transparent',
    border: `1px solid ${hoveredIndex === index ? 'rgba(255,255,255,0.1)' : 'transparent'}`,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background 0.12s ease, border-color 0.12s ease',
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--s1)', borderRight: '1px solid var(--line)', width: '100%', userSelect: 'none', position: 'relative' }}>
      {isUploading && <LoadingOverlay />}
      {isLoading && <MarioLoader title="Creating Workspace" subtitle="Initializing your file…" />}
      <input ref={folderInputRef} type="file" webkitdirectory="" mozdirectory="" directory="" style={{ display: 'none' }} onChange={handleFolderUpload} />
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileUpload} />

      <div style={{ padding: '12px 14px', fontFamily: 'var(--font-header)', fontSize: '0.56rem', fontWeight: 700, color: 'var(--t3)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        <span>Explorer</span>
        <button onClick={onToggle} title="Collapse Sidebar" style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--t1)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--t3)'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <div>
        {/* Workspaces / session actions — only for a truly empty window.
            A restored workspace (files, no session) opens straight into
            Project Files; Alt+N / Alt+J can still summon the forms.
            Hidden while a new-file input is active so the input sits at
            the top of the sidebar instead of below the fold. */}
        {!sessionId && (Object.keys(files).length === 0 || panel) && !newItem && (
          <div style={{
            padding: '22px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            color: 'var(--t1)'
          }}>
            <div style={{ paddingTop: '4px' }}>
              {/* Creative "Workspaces" Typography */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line-faint)' }}>
                <span style={{
                  fontFamily: "var(--font-header), sans-serif",
                  fontSize: '1.25rem',
                  fontWeight: 900,
                  letterSpacing: '-0.02em',
                  textTransform: 'uppercase',
                  lineHeight: 1
                }}>
                  <span style={{ color: '#FFFFFF' }}>Work</span>
                  <span style={{
                    color: 'transparent',
                    WebkitTextStroke: '1px rgba(255,255,255,0.7)',
                    textStroke: '1px rgba(255,255,255,0.7)'
                  }}>spaces</span>
                </span>
              </div>
            </div>

            {!panel && (
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: '8px' }}>
                {/* Header */}
                <div style={{
                  fontFamily: 'var(--font-number)',
                  fontSize: '0.52rem',
                  letterSpacing: '0.18em',
                  color: 'var(--t4)',
                  textTransform: 'uppercase',
                  paddingLeft: '2px',
                  marginBottom: '10px'
                }}>
                  Session Actions
                </div>

                {/* Vertical menu list */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {[
                    {
                      id: 0,
                      num: '01',
                      title: 'New Session',
                      desc: 'Initialize collaborative room',
                      shortcut: 'N',
                      onClick: () => setPanel('create')
                    },
                    {
                      id: 1,
                      num: '02',
                      title: 'Join Session',
                      desc: 'Connect to an active room ID',
                      shortcut: 'J',
                      onClick: () => setPanel('join')
                    },
                    {
                      id: 2,
                      num: '03',
                      title: 'Import Project',
                      desc: 'Load local repository folder',
                      shortcut: 'I',
                      onClick: () => openProjectFolder()
                    },
                    {
                      id: 3,
                      num: '04',
                      title: 'New File',
                      desc: 'Create blank text buffer',
                      shortcut: 'F',
                      onClick: () => startNewFile()
                    }
                  ].map((a) => {
                    const isHovered = hoveredIndex === a.id;
                    return (
                      <div
                        key={a.id}
                        onClick={a.onClick}
                        onMouseEnter={() => setHoveredIndex(a.id)}
                        onMouseLeave={() => setHoveredIndex(null)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '16px 0',
                          borderBottom: '1px solid var(--line-faint)',
                          cursor: 'pointer',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        {/* Number / Arrow sliding indicator */}
                        <div style={{
                          fontFamily: 'var(--font-number)',
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          color: isHovered ? 'transparent' : 'var(--t4)',
                          width: '24px',
                          transition: 'color 0.2s ease, opacity 0.2s ease, transform 0.2s ease',
                          transform: isHovered ? 'translateX(-10px)' : 'none',
                          opacity: isHovered ? 0 : 1,
                          display: 'flex',
                          alignItems: 'center',
                          flexShrink: 0
                        }}>
                          {a.num}
                        </div>

                        <div style={{
                          position: 'absolute',
                          left: 0,
                          top: '50%',
                          transform: isHovered ? 'translateY(-50%) translateX(0)' : 'translateY(-50%) translateX(-20px)',
                          opacity: isHovered ? 1 : 0,
                          color: 'var(--lime)',
                          transition: 'opacity 0.2s ease, transform 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          flexShrink: 0
                        }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <polyline points="12 5 19 12 12 19" />
                          </svg>
                        </div>

                        {/* Title & Desc shifting container */}
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          transition: 'transform 0.2s ease',
                          transform: isHovered ? 'translateX(28px)' : 'translateX(0)',
                          flex: 1,
                          minWidth: 0
                        }}>
                          <span style={{
                            fontFamily: 'var(--font-header)',
                            fontSize: '0.98rem',
                            fontWeight: 800,
                            letterSpacing: '-0.03em',
                            textTransform: 'uppercase',
                            color: isHovered ? '#FFFFFF' : 'var(--t2)',
                            transition: 'color 0.2s ease',
                            lineHeight: 1.1
                          }}>
                            {a.title}
                          </span>
                          <span style={{
                            fontFamily: 'var(--font-body)',
                            fontSize: '0.62rem',
                            fontWeight: 400,
                            color: isHovered ? 'var(--t3)' : 'var(--t4)',
                            transition: 'color 0.2s ease',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            {a.desc}
                          </span>
                        </div>

                        {/* Keyboard shortcut badge */}
                        <span style={{
                          fontFamily: 'var(--font-number)',
                          fontSize: '0.48rem',
                          fontWeight: 600,
                          color: isHovered ? 'var(--lime)' : 'var(--t4)',
                          background: isHovered ? 'rgba(255,255,255,0.06)' : 'transparent',
                          border: `1px solid ${isHovered ? 'var(--lime-line)' : 'transparent'}`,
                          padding: '2px 6px',
                          borderRadius: '3px',
                          textTransform: 'uppercase',
                          transition: 'all 0.2s ease',
                          flexShrink: 0,
                          marginLeft: '10px'
                        }}>
                          {modifier}{a.shortcut}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {newItem && newItem.parent === '' && (
              <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px', border: '2px solid var(--line-strong)', background: 'var(--s0)', marginTop: '4px', borderRadius: '8px' }}>
                <FileIcon name={newItem.name || 'new'} isFolder={newItem.type === 'folder'} />
                <input autoFocus onKeyDown={handleCreateNew} onBlur={() => setNewItem(null)} style={{ ...inputStyle, marginBottom: 0, height: '24px', flex: 1, border: 'none', background: 'transparent' }} placeholder={newItem.type === 'folder' ? 'Folder name...' : 'File name...'} />
              </div>
            )}

            {panel === 'create' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>Your name</label>
                  <input style={inputStyle} value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter your name" />
                </div>
                <div>
                  <label style={labelStyle}>Project name</label>
                  <input style={inputStyle} value={projName} onChange={e => setProjName(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>Password</label>
                  <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="0000" />
                </div>
                <button style={btnStyle(true)} onClick={() => handleCreate()}>{isLoading ? 'Initializing…' : 'Create & Start'}</button>
                <button style={backBtnStyle} onClick={() => setPanel(null)}>← Back</button>
              </div>
            )}

            {panel === 'join' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>Your name</label>
                  <input style={inputStyle} value={joinUsername} onChange={e => setJoinUsername(e.target.value)} placeholder="Enter your name" />
                </div>
                <div>
                  <label style={labelStyle}>Session ID</label>
                  <input style={inputStyle} value={joinId} onChange={e => setJoinId(e.target.value)} placeholder="XYZ..." />
                </div>
                <div>
                  <label style={labelStyle}>Password</label>
                  <input style={inputStyle} type="password" value={joinPwd} onChange={e => setJoinPwd(e.target.value)} />
                </div>
                <button style={btnStyle(true)} onClick={handleJoin}>{isLoading ? 'Joining…' : 'Connect'}</button>
                <button style={backBtnStyle} onClick={() => setPanel(null)}>← Back</button>
              </div>
            )}
          </div>
        )}


        {errorMsg && (
          <div style={{ color: 'var(--crimson)', fontSize: '0.66rem', margin: '10px 14px', padding: '9px 11px', background: 'var(--crimson-dim)', border: '1px solid rgba(229,72,77,0.3)', borderRadius: '6px', fontFamily: 'var(--font-body)', fontWeight: 500, lineHeight: 1.5 }}>
            ⚠ {errorMsg}
          </div>
        )}

        {(sessionId || Object.keys(files).length > 0 || newItem) && (
          <div style={{ padding: '8px 0' }}>
            <style>{`
              .fx-file-del { opacity: 0; pointer-events: none; transition: opacity 0.12s ease; }
              .fx-file-item:hover .fx-file-del { opacity: 1; pointer-events: auto; }
            `}</style>
            <div style={{ padding: '8px 14px', ...sectionLabelSty, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Project Files</span>
              {/* Creating and uploading are edit actions, so viewers do not get
                  them. Taking a copy of the project and viewing history are
                  read-only, and a viewer has every reason to want both. */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--s0)',
                border: '1px solid var(--line-strong)',
                borderRadius: '6px',
                overflow: 'hidden'
              }}>
                {(!sessionId || canEdit) && (
                  <>
                    <ActionButton onClick={() => startNewFile()} title="New File">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
                    </ActionButton>
                    <div style={{ width: '1px', height: '14px', background: 'var(--line)' }} />
                    <ActionButton onClick={() => setNewItem({ type: 'folder', parent: '', name: '' })} title="New Folder">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
                    </ActionButton>
                    <div style={{ width: '1px', height: '14px', background: 'var(--line)' }} />
                    <ActionButton onClick={() => openProjectFolder()} title="Upload Folder">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    </ActionButton>
                    <div style={{ width: '1px', height: '14px', background: 'var(--line)' }} />
                  </>
                )}

                {/* Take a copy of the shared project onto this machine — the
                    project may exist nowhere locally. Mirrors the upload arrow. */}
                {sessionId && (
                  <>
                    <ActionButton
                      onClick={handleSaveProjectLocally}
                      title={canOpenLocalFolder
                        ? 'Save this project to a folder on your computer'
                        : 'Download this project as a .zip'}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    </ActionButton>
                    <div style={{ width: '1px', height: '14px', background: 'var(--line)' }} />
                  </>
                )}

                <ActionButton onClick={() => { setTerminalActiveTab('timeline'); setTerminalOpen(true); }} title="Session Timeline">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                </ActionButton>
              </div>
            </div>
            {newItem && newItem.parent === '' && (
              <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileIcon name={newItem.name || 'new'} isFolder={newItem.type === 'folder'} />
                <input autoFocus onKeyDown={handleCreateNew} onBlur={() => setNewItem(null)} style={{ ...inputStyle, marginBottom: 0, height: '24px', flex: 1, border: 'none', background: 'transparent' }} placeholder={newItem.type === 'folder' ? 'Folder name...' : 'File name...'} />
              </div>
            )}
            {Object.keys(files).length === 0 ? (
              userRole === 'owner' ? (
                <div style={{
                  padding: '24px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: '12px'
                }}>
                  {/* Classy empty drop-zone layout */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '12px'
                  }}>
                    <div style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '4px',
                      background: 'var(--s2)',
                      border: '1px solid var(--line)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--t3)'
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div style={{
                        fontFamily: 'var(--font-header)',
                        fontSize: '0.76rem',
                        fontWeight: 900,
                        color: '#FFFFFF',
                        letterSpacing: '-0.02em',
                        textTransform: 'uppercase'
                      }}>
                        Awaiting Project
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: '0.62rem',
                        color: 'var(--t4)',
                        lineHeight: 1.4
                      }}>
                        {canOpenLocalFolder
                          ? 'Open a folder to edit it in place. Your files stay on your disk — no session needed.'
                          : 'Upload a directory or select files to initialize the workspace.'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                    {/* Opens the folder in place: edits are written straight back to
                        disk, so they show up in any other editor and nothing is
                        copied into the database. Desktop app only. */}
                    {canOpenLocalFolder && (
                      <button
                        style={{
                          background: '#FFFFFF',
                          border: 'none',
                          borderRadius: '3px',
                          color: '#000000',
                          fontFamily: 'var(--font-header)',
                          fontSize: '0.62rem',
                          fontWeight: 900,
                          padding: '10px 14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          letterSpacing: '0.04em',
                          transition: 'transform 0.1s ease, background 0.15s ease'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#EDEDED'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#FFFFFF'; }}
                        onClick={handleOpenLocalFolder}
                        title="Edit files directly on your disk — no session, changes visible to other editors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          <path d="M12 11v6M9 14h6" />
                        </svg>
                        OPEN FOLDER
                      </button>
                    )}
                    {/* Browser fallback only. On the desktop, OPEN FOLDER above
                        covers this — and copying a project into a session is now
                        something you opt into via New Session, not a way to open
                        a folder. */}
                    {!canOpenLocalFolder && (
                      <button
                        style={{
                          background: '#FFFFFF',
                          border: 'none',
                          borderRadius: '3px',
                          color: '#000000',
                          fontFamily: 'var(--font-header)',
                          fontSize: '0.62rem',
                          fontWeight: 900,
                          padding: '10px 14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          letterSpacing: '0.04em',
                          transition: 'transform 0.1s ease, background 0.15s ease'
                        }}
                        onClick={() => openProjectFolder()}
                        title="Upload the folder into a workspace"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        IMPORT FOLDER
                      </button>
                    )}
                    {/* Loose files have no project root to be saved back into, so
                        on the desktop they would only be storable in a session —
                        which is exactly what we no longer create implicitly. Open
                        a folder instead. */}
                    {!canOpenLocalFolder && (
                      <button
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--line-strong)',
                          borderRadius: '3px',
                          color: 'var(--t2)',
                          fontFamily: 'var(--font-number)',
                          fontSize: '0.58rem',
                          fontWeight: 900,
                          padding: '9px 14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          letterSpacing: '0.06em',
                          transition: 'color 0.15s ease, border-color 0.15s ease'
                        }}
                        onClick={() => fileInputRef.current?.click()}
                        onMouseEnter={e => { e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.borderColor = '#FFFFFF'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--t2)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                          <polyline points="13 2 13 9 20 9" />
                        </svg>
                        SELECT FILES
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: '36px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  textAlign: 'center'
                }}>
                  <span className="loading-spinner" style={{ width: '14px', height: '14px', borderColor: 'var(--cyan) transparent' }} />
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: '0.64rem',
                    color: 'var(--t3)',
                    lineHeight: 1.5,
                    maxWidth: '180px'
                  }}>
                    Waiting for the session owner to upload files…
                  </div>
                </div>
              )
            ) : (
              renderTree(tree)
            )}
            
            {/* Flat Integrated Session Panel */}
            <div style={{
              margin: '24px 14px 12px',
              borderTop: '1px solid var(--line-faint)',
              paddingTop: '16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '4px'
            }}>
              <div style={{
                fontFamily: 'var(--font-header)',
                fontSize: '0.9rem',
                fontWeight: 900,
                color: '#FFFFFF',
                letterSpacing: '-0.02em',
                textTransform: 'uppercase',
                lineHeight: 1.2,
                wordBreak: 'break-all',
                width: '100%'
              }}>
                {workspaceRoot ? (workspaceName || 'Local Folder') : (sessionName || 'Local Session')}
              </div>

              {/* Where the files actually live, so it's never ambiguous whether
                  edits are hitting the disk or a session. */}
              {workspaceRoot && (
                <div
                  title={workspaceRoot}
                  style={{
                    fontFamily: 'var(--font-number)',
                    fontSize: '0.5rem',
                    color: 'var(--t4)',
                    letterSpacing: '0.04em',
                    wordBreak: 'break-all',
                    width: '100%',
                    marginBottom: '2px'
                  }}
                >
                  {workspaceRoot}
                </div>
              )}

              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontFamily: 'var(--font-number)',
                fontSize: '0.52rem',
                fontWeight: 900,
                color: '#000000',
                background: '#FFFFFF',
                padding: '2px 8px',
                borderRadius: '3px',
                letterSpacing: '0.08em',
                marginTop: '6px'
              }}>
                <span style={{
                  width: '4px',
                  height: '4px',
                  borderRadius: '50%',
                  background: '#000000'
                }} />
                {workspaceRoot ? 'ON DISK' : userRole === 'owner' ? 'OWNER' : 'COLLAB'}
              </div>

              <button
                onClick={handleDisconnect}
                title={sessionId
                  ? 'Leave this session (your files stay on disk)'
                  : 'Close this folder (your files stay on disk)'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  color: 'var(--t3)',
                  fontFamily: 'var(--font-number)',
                  fontSize: '0.56rem',
                  fontWeight: 900,
                  letterSpacing: '0.08em',
                  cursor: 'pointer',
                  marginTop: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'color 0.15s ease'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = '#FFFFFF';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--t3)';
                }}
              >
                <span>✕</span>
                <span style={{ textDecoration: 'underline' }}>
                  {sessionId ? 'LEAVE SESSION' : 'CLOSE FOLDER'}
                </span>
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default FileExplorer;
