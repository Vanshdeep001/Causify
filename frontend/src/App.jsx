/* -------------------------------------------------------
 * App.jsx — DebugSync Application Shell
 * ------------------------------------------------------- */

import React, { useEffect, useRef } from 'react';
import EditorPage from './pages/EditorPage';
import UserPresence from './components/Session/UserPresence';
import NotificationSystem from './components/Session/NotificationSystem';
import useEditorStore from './store/useEditorStore';
import { connectWebSocket, disconnectWebSocket } from './services/socket';
import { getSessionFiles } from './services/api';

const App = () => {
  const sessionId = useEditorStore((s) => s.sessionId);
  const currentUser = useEditorStore((s) => s.currentUser);
  const toggleTerminal = useEditorStore((s) => s.toggleTerminal);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const reconnectedRef = useRef(false);

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
          useEditorStore.getState().updateRemoteCursor(d.userId, d);
        }
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
        console.log('[Causify] Reconnected to Collab');
        // Fetch latest files from backend to ensure sync
        getSessionFiles(sessionId).then((serverFiles) => {
          if (serverFiles && serverFiles.length > 0) {
            const fileMap = {};
            serverFiles.forEach(f => { fileMap[f.path] = f.content; });
            const currentState = useEditorStore.getState();
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
    <div className="app-container">
      {/* Texture overlay with pointer-events: none */}
      <div className="organic-texture" />

      <header className="app-header" style={{ 
        borderBottom: 'var(--border-thick)', 
        background: 'var(--bg-paper)', 
        padding: '0 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '48px',
        position: 'relative',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <h1 className="logo-text" style={{ margin: 0, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>CAUSIFY</h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          {sessionId && <UserPresence />}
        </div>
      </header>

      <main className="app-main" style={{ position: 'relative', zIndex: 5 }}>
        <EditorPage />
      </main>

      <NotificationSystem />

      {/* Global SVG Organic Grain Filter */}
      <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <filter id="organic-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.15 0" />
          <feComposite operator="in" in2="SourceGraphic" />
        </filter>
      </svg>
    </div>
  );
};

export default App;
