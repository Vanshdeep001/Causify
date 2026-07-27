/* -------------------------------------------------------
 * App.jsx — DebugSync Application Shell
 * ------------------------------------------------------- */

import React, { useEffect, useRef, useState } from 'react';
import EditorPage from './pages/EditorPage';
import UserPresence from './components/Session/UserPresence';
import VoiceRoom from './components/Session/VoiceRoom';
import NotificationSystem from './components/Session/NotificationSystem';
import CodeShotModal from './components/CodeShot/CodeShotModal';
import { parseCodeShotLink } from './utils/codeShotDeepLink';
import useEditorStore from './store/useEditorStore';
import { connectWebSocket, disconnectWebSocket } from './services/socket';
import { getSessionFiles, saveFile, getSession, touchSession, leaveSession } from './services/api';
import MigrateWorkspaceModal from './components/Editor/MigrateWorkspaceModal';
import causifyLogo from './assets/causify-logo.png';

// Module-level so React StrictMode's double-mount can't run the bootstrap twice
let sessionRehydrateAttempted = false;

const App = () => {
  const sessionId = useEditorStore((s) => s.sessionId);
  const sessionName = useEditorStore((s) => s.sessionName);
  const currentUser = useEditorStore((s) => s.currentUser);
  const toggleTerminal = useEditorStore((s) => s.toggleTerminal);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const followToast = useEditorStore((s) => s.followToast);
  const reconnectedRef = useRef(false);
  // Gate the WebSocket reconnect until the session-bootstrap below has decided
  // the final sessionId (verified-existing vs freshly-recreated), so we never
  // connect to a stale id.
  const [bootstrapDone, setBootstrapDone] = useState(false);

  // Set when launch finds a workspace whose files live only inside the app —
  // { fileCount, name } — which prompts the one-time move to a real folder.
  const [legacyWorkspace, setLegacyWorkspace] = useState(null);

  /**
   * Move a pre-local-mode workspace onto disk.
   *
   * The files are read from the store rather than the backend: that copy is
   * always present, needs no network, and is the one the user has been looking
   * at. Once they are safely written, the old session is deleted so the same
   * project is not left duplicated in the database.
   *
   * Returns false if the user backed out of the folder picker.
   */
  const migrateLegacyWorkspace = async () => {
    const store = useEditorStore.getState();
    const entries = Object.entries(store.files || {});
    if (entries.length === 0) { setLegacyWorkspace(null); return true; }

    const placed = await window.electronAPI.workspace.materialize(Object.fromEntries(entries));
    if (!placed) return false; // cancelled — keep the prompt up

    store.openLocalWorkspace(placed);

    // The files are on disk now, so the session copy is redundant.
    const oldSessionId = store.sessionId;
    if (oldSessionId) {
      try {
        await leaveSession(oldSessionId, store.currentUser?.id);
      } catch (err) {
        console.warn('[Causify] Could not release the old session:', err.message);
      }
      useEditorStore.getState().resetSession();
    }

    console.log(`[Causify] Moved ${placed.written} file(s) to ${placed.root}`);
    setLegacyWorkspace(null);
    return true;
  };

  // ── Bootstrap on launch ──
  // Three cases, none of which creates a session:
  //   • a folder opened from disk  → re-read it and carry on
  //   • a live session             → keep it, and mark it as in use
  //   • files from before local mode existed → offer to move them onto disk
  // Causify no longer mints a session on its own; that only happens when the
  // user starts or joins one.
  useEffect(() => {
    // StrictMode remount (or a prior mount) already ran the bootstrap — just
    // release the reconnect gate so it isn't left waiting forever.
    if (sessionRehydrateAttempted) { setBootstrapDone(true); return; }
    sessionRehydrateAttempted = true;

    (async () => {
      try {
        const store = useEditorStore.getState();

        // A folder opened from disk restores itself: re-read the directory so
        // files added or removed outside Causify are picked up. It deliberately
        // returns before the session logic below — a local workspace needs no
        // session, and uploading it would recreate the duplication that local
        // mode exists to avoid.
        if (store.workspaceRoot && window.electronAPI?.workspace) {
          try {
            const restored = await window.electronAPI.workspace.reopen(store.workspaceRoot);
            if (restored) {
              store.openLocalWorkspace(restored);
              console.log('[Causify] Reopened local workspace:', restored.root);
            } else {
              console.warn('[Causify] Previously opened folder is gone — clearing it.');
              store.closeLocalWorkspace();
            }
          } catch (err) {
            console.warn('[Causify] Could not reopen the local workspace:', err.message);
          }
          return;
        }

        const fileEntries = Object.entries(store.files || {});

        // Verify a persisted session — keep it if the backend still has it, and
        // mark it as in use so the retention sweep leaves it alone.
        if (store.sessionId && store.currentUser) {
          try {
            const data = await getSession(store.sessionId);
            if (data && (data.id || data.sessionId)) {
              touchSession(store.sessionId).catch(() => { /* best effort */ });
              return; // alive — reconnect handles the rest
            }
          } catch {
            console.warn('[Causify] Stored session is no longer on the backend.');
          }
        }

        if (fileEntries.length === 0) return; // fresh start — nothing to attach

        // A workspace from before local mode: its files exist only inside the
        // app. Offer to move them onto disk rather than silently recreating a
        // session to hold them, which is what used to make sessions pile up.
        if (window.electronAPI?.workspace) {
          setLegacyWorkspace({ fileCount: fileEntries.length, name: store.sessionName });
        }
      } catch (err) {
        console.warn('[Causify] Could not bootstrap:', err.message);
      } finally {
        setBootstrapDone(true);
      }
    })();
  }, []);

  // Mouse tracking state for cursor-following background glow
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handleMouseMove = (e) => {
      setCoords({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // ── Deep-link navigation handler (Electron causify:// protocol) ──
  useEffect(() => {
    if (!window.electronAPI?.onCodeShotNavigate) return;

    const unsubscribe = window.electronAPI.onCodeShotNavigate((data) => {
      if (!data) return;
      console.log('[Causify] Deep-link navigation:', data);

      const store = useEditorStore.getState();

      // If a file path is provided, navigate to it
      if (data.filePath && store.files[data.filePath]) {
        store.openFile(data.filePath);

        // After a short delay for Monaco to mount, highlight the line range
        setTimeout(() => {
          const editor = document.querySelector('.monaco-editor');
          if (editor && window.monaco) {
            // Find the editor instance via Monaco's getEditors API
            const editors = window.monaco.editor.getEditors();
            if (editors.length > 0) {
              const ed = editors[0];
              const startLine = data.startLine || 1;
              const endLine = data.endLine || startLine;

              ed.revealLineInCenter(startLine);
              ed.setSelection(new window.monaco.Range(
                startLine, 1, endLine,
                ed.getModel()?.getLineMaxColumn(endLine) || 1
              ));
              ed.focus();
            }
          }
        }, 300);
      }
    });

    return unsubscribe;
  }, []);

  // ── Auto-reconnect WebSocket after refresh / reopen ──
  // Waits for the bootstrap above to settle the final sessionId, so we connect
  // to the verified (or freshly recreated) session, never a stale id.
  useEffect(() => {
    if (!bootstrapDone) return;
    if (reconnectedRef.current) return;
    if (!sessionId || !currentUser) return;

    reconnectedRef.current = true;
    console.log('[Causify] Reconnecting to session:', sessionId);

    const store = useEditorStore.getState();

    // Reconnect WebSocket
    connectWebSocket(sessionId, currentUser, {
      onCodeChange: (d) => {
        const currentU = useEditorStore.getState().currentUser;
        const isOwnChange = d.userId === currentU?.id;
        useEditorStore.getState().updateRemoteFile(d.path, d.code, isOwnChange ? null : d.userId);
      },
      onUsersChange: (d) => useEditorStore.getState().setConnectedUsers(d.users || []),
      onExecutionResult: (d) => useEditorStore.getState().handleExecutionResult(d),
      onSnapshot: (d) => useEditorStore.getState().addSnapshot(d),
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
      onVoiceSignal: (d) => {
        // Route to VoiceRoom component via global handler
        if (window._onVoiceSignal) window._onVoiceSignal(d);
      },
      onUserKicked: (d) => {
        const currentU = useEditorStore.getState().currentUser;
        if (d.userId === currentU?.id) {
          alert("You have been removed from the session by the owner.");
          const store = useEditorStore.getState();
          store.resetGit();
          useEditorStore.setState({
            sessionId: null,
            sessionName: '',
            currentUser: null,
            userRole: null,
            connectedUsers: [],
          });
          disconnectWebSocket();
          window.location.reload();
        }
      },
      onFollowUpdate: (d) => {
        const store = useEditorStore.getState();
        const currentU = store.currentUser;
        if (!currentU) return;

        if (d.type === 'follow-start') {
          // Someone started following us
          if (d.leaderId === currentU.id) {
            store.addFollower(d.followerId);
            const followerUser = store.connectedUsers.find(u => u.id === d.followerId);
            store.setFollowToast(`${followerUser?.username || 'Someone'} is now following you`);
          }
        } else if (d.type === 'follow-stop') {
          // Someone stopped following us
          if (d.leaderId === currentU.id) {
            store.removeFollower(d.followerId);
          }
          // If we were following them and they stopped (shouldn't happen, but guard)
          if (d.followerId === currentU.id) {
            store.stopFollowing();
          }
        } else if (d.type === 'follow-state') {
          // Incoming leader editor state — only process if we're following this leader
          if (store.followingUserId === d.leaderId) {
            store.setFollowState(d);
          }
        }
      },
      onConnected: () => {
        console.log('[Causify] Reconnected to Collab');
        const currentState = useEditorStore.getState();
        currentState.loadSessionHistory(sessionId);
        // Fetch latest files from backend to ensure sync
        getSessionFiles(sessionId).then((serverFiles) => {
          if (serverFiles && serverFiles.length > 0) {
            const fileMap = {};
            serverFiles.forEach(f => { fileMap[f.path] = f.content; });
            // Merge: use server files as base, keeping local activePath
            useEditorStore.setState({
              files: fileMap,
              code: fileMap[currentState.activePath] || serverFiles[0].content || '',
              activePath: fileMap[currentState.activePath] ? currentState.activePath : serverFiles[0].path,
            });
          }
        }).catch((err) => {
          // File fetch is best-effort — we already have files from localStorage.
          // The WebSocket connected successfully, so the session IS alive.
          console.warn('[Causify] Could not fetch files on reconnect, using cached files:', err.message);
        });
      },
    });
  }, [bootstrapDone, sessionId, currentUser]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl + S -> Save current file
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const state = useEditorStore.getState();
        if (!state.activePath) return;

        // Local mode writes to the real file; otherwise persist to the session
        // as before.
        if (state.workspaceRoot) {
          state.writeLocalFile(state.activePath, state.code)
            .then(() => console.log('[Causify] Saved to disk:', state.activePath))
            .catch((err) => console.error('[Causify] Disk save failed:', err));
        } else if (state.sessionId) {
          saveFile(state.sessionId, state.activePath, state.code)
            .then(() => console.log('[Causify] File saved:', state.activePath))
            .catch((err) => console.error('[Causify] Save failed:', err));
        }
      }
      // Ctrl + ` (backtick) -> Toggle Terminal
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        toggleTerminal();
      }
      // Ctrl + 1 -> Output
      if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        setTerminalActiveTab('output');
      }
      // Ctrl + 2 -> Timeline
      if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        setTerminalActiveTab('timeline');
      }
      // Ctrl + 3 -> Graph
      if (e.ctrlKey && e.key === '3') {
        e.preventDefault();
        setTerminalActiveTab('graph');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      disconnectWebSocket();
    };
  }, [toggleTerminal, setTerminalActiveTab]);

  return (
    <div className="app-container" style={{
      '--mouse-x': `${coords.x}px`,
      '--mouse-y': `${coords.y}px`
    }}>
      {/* Canvas: blueprint grid, barely visible */}
      <div className="cockpit-env">
        <div className="cockpit-grid" />
        <div className="cursor-glow" />
      </div>

      {/* ── Top navigation — premium OS toolbar ── */}
      <header className="app-header" style={{
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(17, 17, 17, 0.65)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '48px',
        position: 'relative',
        zIndex: 10
      }}>
        {/* Left: brand + project */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <img src={causifyLogo} alt="Causify Logo" style={{ height: '24px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ width: '1px', height: '18px', background: 'var(--line-strong)' }} />
          <span style={{
            fontFamily: 'var(--font-header)',
            fontSize: '0.64rem',
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--lime)',
            background: 'var(--lime-dim)',
            border: '1px solid var(--lime-line)',
            borderRadius: '4px',
            padding: '3px 8px',
          }}>
            {sessionName || 'CORE'}
          </span>
          {sessionId && (
            <span style={{
              fontFamily: 'var(--font-number)', fontSize: '0.58rem',
              color: 'var(--t3)', background: 'var(--s3)',
              border: '1px solid var(--line)', borderRadius: '4px',
              padding: '2px 8px', letterSpacing: '0.04em',
            }}>
              {sessionId.substring(0, 8)}
            </span>
          )}
        </div>

        {/* Right: collaboration + session status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', height: '100%' }}>
          {sessionId && <VoiceRoom />}
          {sessionId && <UserPresence />}
        </div>
      </header>

      <main className="app-main" style={{ position: 'relative', zIndex: 5 }}>
        <EditorPage />
      </main>

      <NotificationSystem />
      <CodeShotModal />

      {/* One-time prompt to move a pre-local-mode workspace onto disk. */}
      {legacyWorkspace && (
        <MigrateWorkspaceModal
          fileCount={legacyWorkspace.fileCount}
          workspaceName={legacyWorkspace.name}
          onMigrate={migrateLegacyWorkspace}
          onSkip={() => setLegacyWorkspace(null)}
        />
      )}

      {/* Follow mode toast */}
      {followToast && (
        <div className="follow-toast">
          {followToast}
        </div>
      )}
    </div>
  );
};

export default App;
