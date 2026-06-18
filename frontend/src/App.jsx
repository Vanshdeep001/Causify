/* -------------------------------------------------------
 * App.jsx — DebugSync Application Shell
 * ------------------------------------------------------- */

import React, { useEffect, useRef, useState } from 'react';
import EditorPage from './pages/EditorPage';
import UserPresence from './components/Session/UserPresence';
import VoiceRoom from './components/Session/VoiceRoom';
import NotificationSystem from './components/Session/NotificationSystem';
import SetupWizard from './components/Session/SetupWizard';
import CodeShotModal from './components/CodeShot/CodeShotModal';
import { parseCodeShotLink } from './utils/codeShotDeepLink';
import useEditorStore from './store/useEditorStore';
import { connectWebSocket, disconnectWebSocket } from './services/socket';
import { getSessionFiles, saveFile } from './services/api';
import causifyLogo from './assets/causify-logo.png';

const App = () => {
  const sessionId = useEditorStore((s) => s.sessionId);
  const sessionName = useEditorStore((s) => s.sessionName);
  const currentUser = useEditorStore((s) => s.currentUser);
  const toggleTerminal = useEditorStore((s) => s.toggleTerminal);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const followToast = useEditorStore((s) => s.followToast);
  const reconnectedRef = useRef(false);

  // Mouse tracking state for cursor-following background glow
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handleMouseMove = (e) => {
      setCoords({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // ── First-launch setup wizard (Electron only) ──
  const [showSetup, setShowSetup] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);

  useEffect(() => {
    const checkFirstLaunch = async () => {
      if (window.electronAPI && window.electronAPI.isFirstLaunch) {
        const isFirst = await window.electronAPI.isFirstLaunch();
        setShowSetup(isFirst);
      }
      setSetupChecked(true);
    };
    checkFirstLaunch();
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

  // ── Auto-reconnect WebSocket after page refresh ──
  useEffect(() => {
    if (reconnectedRef.current) return;
    if (!sessionId || !currentUser) return;

    reconnectedRef.current = true;
    console.log('[Causify] Reconnecting to session after refresh:', sessionId);

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
  }, [sessionId, currentUser]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl + S -> Save current file
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const state = useEditorStore.getState();
        if (state.sessionId && state.activePath) {
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

  // Show Setup Wizard before the main app if this is first launch
  if (showSetup) {
    return <SetupWizard onComplete={() => setShowSetup(false)} />;
  }

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
