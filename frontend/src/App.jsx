/* -------------------------------------------------------
 * App.jsx — DebugSync Application Shell
 * ------------------------------------------------------- */

import React, { useEffect } from 'react';
import EditorPage from './pages/EditorPage';
import UserPresence from './components/Session/UserPresence';
import NotificationSystem from './components/Session/NotificationSystem';
import useEditorStore from './store/useEditorStore';
import { disconnectWebSocket } from './services/socket';

const App = () => {
  const sessionId = useEditorStore((s) => s.sessionId);
  const toggleTerminal = useEditorStore((s) => s.toggleTerminal);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);

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
        padding: '0 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '80px',
        position: 'relative',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 className="logo-text" style={{ margin: 0, fontSize: '1.8rem', letterSpacing: '-0.02em' }}>CAUSIFY</h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
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
