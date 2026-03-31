/* -------------------------------------------------------
 * EditorPage.jsx — Main Application Workspace
 * ------------------------------------------------------- */

import React from 'react';
import MonacoEditor from '../components/Editor/MonacoEditor';
import TerminalPanel from '../components/Terminal/TerminalPanel';
import useEditorStore from '../store/useEditorStore';

import FileExplorer from '../components/Editor/FileExplorer';
import EmptyEditorState from '../components/Editor/EmptyEditorState';


const EditorPage = () => {
  const isTerminalOpen       = useEditorStore((s) => s.isTerminalOpen);
  const terminalHeight       = useEditorStore((s) => s.terminalHeight);
  const isRunning            = useEditorStore((s) => s.isRunning);
  const isReplaying          = useEditorStore((s) => s.isReplaying);
  const error                = useEditorStore((s) => s.error);
  const snapshots            = useEditorStore((s) => s.snapshots);
  const language             = useEditorStore((s) => s.language);
  const currentSnapshotIndex = useEditorStore((s) => s.currentSnapshotIndex);
  const sessionId            = useEditorStore((s) => s.sessionId);
  const sessionName          = useEditorStore((s) => s.sessionName);
  const isFileExplorerOpen   = useEditorStore((s) => s.isFileExplorerOpen);
  const fileActivity         = useEditorStore((s) => s.fileActivity);
  const currentUser          = useEditorStore((s) => s.currentUser);
  const userRole             = useEditorStore((s) => s.userRole);

  const runCode              = useEditorStore((s) => s.runCode);
  const goToLive             = useEditorStore((s) => s.goToLive);
  const setLanguage          = useEditorStore((s) => s.setLanguage);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const setFileExplorerOpen  = useEditorStore((s) => s.setFileExplorerOpen);
  const activePath           = useEditorStore((s) => s.activePath);
  const connectedUsers       = useEditorStore((s) => s.connectedUsers);

  const hasError     = Boolean(error && error.trim());
  const hasSnapshots = snapshots.length > 0;

  const openReplay = () => setTerminalActiveTab('timeline');

  /* ── Shared toolbar button base styles ── */
  const H = '34px'; // uniform height for all toolbar controls

  return (
    <div
      className="dashboard-layout"
      style={{
        /* When terminal is open, pad the bottom so editor content isn't hidden behind it */
        paddingBottom: isTerminalOpen
          ? `calc(var(--gutter) + ${terminalHeight}px)`
          : 'var(--gutter)',
      }}
    >
      <div className="bento-tile tile-main" style={{ padding: 0 }}>

        {/* ────── Toolbar ────── */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '12px 1.5rem',
          borderBottom: '2px solid #080808',
          background: '#f9f9f9',
          zIndex: 20
        }}>

          {/* LEFT — title + status chip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button 
              onClick={() => setFileExplorerOpen(!isFileExplorerOpen)}
              style={{
                background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: 0, opacity: 0.7
              }}
              title="Toggle File Explorer"
            >
              {isFileExplorerOpen ? '📁' : '📂'}
            </button>

            {activePath ? (
              <span style={{ 
                fontFamily: 'var(--font-header)', 
                fontWeight: 900, 
                fontSize: '0.9rem', 
                letterSpacing: '-0.02em',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                {activePath.split('/').pop().toUpperCase()}
                <span style={{ fontWeight: 400, color: '#999', fontSize: '0.7rem' }}>— {activePath}</span>
              </span>
            ) : (
              <span style={{ 
                fontFamily: 'var(--font-header)', 
                fontWeight: 900, 
                fontSize: '0.9rem', 
                letterSpacing: '-0.02em',
                color: '#aaa'
              }}>
                NO FILE OPEN
              </span>
            )}

            {/* Tiny status chip */}
            {sessionId && (
              isReplaying ? (
                <button
                  onClick={goToLive}
                  style={{
                    height: '22px', padding: '0 8px',
                    fontFamily: 'var(--font-number)', fontWeight: 700, fontSize: '0.58rem',
                    color: '#2d5bff', background: 'transparent',
                    border: '1.5px solid #2d5bff', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#2d5bff', flexShrink: 0 }} />
                  SNAPSHOT #{currentSnapshotIndex + 1}
                </button>
              ) : (
                <span style={{
                  height: '22px', display: 'inline-flex', alignItems: 'center', gap: '5px',
                  fontFamily: 'var(--font-number)', fontWeight: 700, fontSize: '0.58rem', color: '#999',
                }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#c1ff72', animation: 'pulse-live 1.5s ease-in-out infinite' }} />
                  LIVE
                </span>
              )
            )}
          </div>

          {/* RIGHT — uniform-height controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>

            {/* Session Info — only when session is active */}
            {sessionId && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '0 12px', height: '28px', background: '#eee',
                border: '1px dashed #aaa', borderRadius: '4px'
              }}>
                {/* Role badge */}
                <span style={{ 
                  fontSize: '0.5rem', fontWeight: 900, 
                  color: userRole === 'owner' ? '#16a34a' : '#6366f1',
                  background: userRole === 'owner' ? '#dcfce7' : '#ede9fe',
                  padding: '1px 5px', borderRadius: '2px'
                }}>
                  {userRole === 'owner' ? 'OWNER' : 'VIEWER'}
                </span>
                <span style={{ fontSize: '0.6rem', fontWeight: 900, color: '#777' }}>ID: {sessionId?.substring(0,6)}</span>
                {userRole === 'owner' && (
                  <button 
                    onClick={() => { navigator.clipboard.writeText(sessionId); alert('Session ID copied!'); }}
                    style={{ 
                      background: '#080808', color: '#fff', border: 'none', 
                      fontSize: '0.5rem', padding: '2px 6px', cursor: 'pointer', borderRadius: '2px' 
                    }}
                  >
                    COPY
                  </button>
                )}
              </div>
            )}

            {/* Language */}
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={{
                height: H, padding: '0 28px 0 10px',
                fontFamily: 'var(--font-number)', fontWeight: 700, fontSize: '0.7rem',
                background: '#fff', color: '#080808',
                border: '2px solid #080808', cursor: 'pointer', appearance: 'none',
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M0 2l4 4 4-4z'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
              }}
            >
              <option value="javascript">JS</option>
              <option value="java">JAVA</option>
              <option value="python">PYTHON</option>
              <option value="html">HTML</option>
              <option value="css">CSS</option>
            </select>

            {/* Thin vertical divider */}
            <div style={{ width: '1px', height: '18px', background: '#d0d0d0' }} />

            {/* Replay — appears only when there's an error */}
            {hasError && hasSnapshots && !isReplaying && userRole === 'owner' && (
              <button
                onClick={openReplay}
                title="Open snapshot timeline to find where the bug appeared"
                onMouseEnter={e => { e.currentTarget.style.background = '#ff3e3e'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#ff3e3e'; }}
                style={{
                  height: H, padding: '0 14px',
                  fontFamily: 'var(--font-number)', fontWeight: 700, fontSize: '0.7rem',
                  background: 'transparent', color: '#ff3e3e',
                  border: '2px solid #ff3e3e', cursor: 'pointer',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                ⏮ REPLAY
              </button>
            )}

            {/* Primary action */}
            {isReplaying ? (
              <button
                onClick={goToLive}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                style={{
                  height: H, padding: '0 18px',
                  fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '0.7rem',
                  background: '#2d5bff', color: '#fff',
                  border: '2px solid #2d5bff', cursor: 'pointer',
                  transition: 'opacity 0.12s',
                }}
              >
                ✕ EXIT REPLAY
              </button>
            ) : (
              <button
                onClick={runCode}
                disabled={isRunning || !sessionId}
                title={!sessionId ? 'Create or join a session first' : ''}
                onMouseEnter={e => { if (!isRunning && sessionId) e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                style={{
                  height: H, padding: '0 20px',
                  fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '0.7rem',
                  background: (isRunning || !sessionId) ? '#e0e0e0' : '#c1ff72', color: '#080808',
                  border: '2px solid #080808',
                  cursor: (isRunning || !sessionId) ? 'not-allowed' : 'pointer',
                  transition: 'opacity 0.12s',
                }}
              >
                {isRunning ? '● RUNNING…' : '▶ RUN'}
              </button>
            )}
          </div>
        </div>

        {/* ────── Main Content Area ────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          
          {/* File Explorer Sidebar */}
          {isFileExplorerOpen && (
            <div style={{ width: '260px', flexShrink: 0 }}>
              <FileExplorer />
            </div>
          )}

          {/* Editor Canvas */}
          <div style={{ flex: 1, position: 'relative', minHeight: '400px' }}>
            {activePath ? (
              <>
                {/* Collaborative Activity Banner */}
                {Object.values(fileActivity).some(a => a.path === activePath && a.userId !== currentUser?.id) && (
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
                    background: '#080808', color: '#fff',
                    borderBottom: '2px solid #2d5bff',
                    padding: '8px 1.5rem',
                    fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '0.65rem',
                    display: 'flex', alignItems: 'center', gap: '8px',
                    animation: 'slide-down-banner 0.3s'
                  }}>
                    <span style={{ fontSize: '1rem' }}>⚠️</span>
                    <span>
                      {Object.values(fileActivity)
                        .filter(a => a.path === activePath && a.userId !== currentUser?.id)
                        .map(a => a.username.toUpperCase())
                        .join(', ')} IS ALSO EDITING THIS FILE
                    </span>
                  </div>
                )}

                <MonacoEditor />
                
                <style>{`
                  @keyframes slide-down-banner {
                    from { transform: translateY(-100%); }
                    to { transform: translateY(0); }
                  }
                `}</style>
                {/* Snapshot-mode hint overlay */}
                {isReplaying && (
                  <div style={{
                    position: 'absolute', bottom: '12px', right: '12px', zIndex: 10,
                    fontFamily: 'var(--font-number)', fontWeight: 700, fontSize: '0.62rem',
                    color: '#2d5bff', background: 'rgba(45,91,255,0.08)',
                    border: '1.5px solid #2d5bff', padding: '5px 12px',
                    pointerEvents: 'none',
                  }}>
                    📸 READ-ONLY — SNAPSHOT #{currentSnapshotIndex + 1}
                  </div>
                )}
              </>
            ) : (
              <EmptyEditorState />
            )}
          </div>
        </div>
      </div>

      {/* Bottom Terminal */}
      <TerminalPanel />
    </div>
  );
};

export default EditorPage;
