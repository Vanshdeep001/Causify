/* -------------------------------------------------------
 * EditorPage.jsx — Main Application Workspace
 * ------------------------------------------------------- */

import React, { useState } from 'react';
import MonacoEditor from '../components/Editor/MonacoEditor';
import TerminalPanel from '../components/Terminal/TerminalPanel';
import useEditorStore from '../store/useEditorStore';

import FileExplorer from '../components/Editor/FileExplorer';
import EmptyEditorState from '../components/Editor/EmptyEditorState';
import ImpactWarningBanner from '../components/Editor/ImpactWarningBanner';


const EditorPage = () => {
  const [copied, setCopied] = useState(false);
  const isTerminalOpen       = useEditorStore((s) => s.isTerminalOpen);
  const terminalHeight       = useEditorStore((s) => s.terminalHeight);
  const isRunning            = useEditorStore((s) => s.isRunning);
  const isReplaying          = useEditorStore((s) => s.isReplaying);
  const error                = useEditorStore((s) => s.error);
  const snapshots            = useEditorStore((s) => s.snapshots);
  const currentSnapshotIndex = useEditorStore((s) => s.currentSnapshotIndex);
  const sessionId            = useEditorStore((s) => s.sessionId);
  const sessionName          = useEditorStore((s) => s.sessionName);
  const isFileExplorerOpen   = useEditorStore((s) => s.isFileExplorerOpen);
  const fileActivity         = useEditorStore((s) => s.fileActivity);
  const currentUser          = useEditorStore((s) => s.currentUser);
  const userRole             = useEditorStore((s) => s.userRole);

  const runCode              = useEditorStore((s) => s.runCode);
  const goToLive             = useEditorStore((s) => s.goToLive);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const setFileExplorerOpen  = useEditorStore((s) => s.setFileExplorerOpen);
  const activePath           = useEditorStore((s) => s.activePath);
  const connectedUsers       = useEditorStore((s) => s.connectedUsers);

  const terminalLayoutMode = useEditorStore((s) => s.terminalLayoutMode);

  const hasError     = Boolean(error && error.trim());
  const hasSnapshots = snapshots.length > 0;

  const openReplay = () => setTerminalActiveTab('timeline');

  /* ── Shared toolbar button base styles ── */
  const H = '28px'; // uniform height for all toolbar controls

  // Calculate dynamic heights/paddings based on terminal mode
  const headerH = 48;
  const terminalPadding = !isTerminalOpen ? 'var(--gutter)' :
    terminalLayoutMode === 'maximized' ? `calc(100vh - ${headerH}px)` :
    terminalLayoutMode === 'split' ? `calc((100vh - ${headerH}px) / 2)` :
    `${terminalHeight + 20}px`;

  return (
    <div
      className="dashboard-layout"
      style={{
        paddingBottom: terminalPadding,
        transition: 'padding-bottom 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        minHeight: `calc(100vh - ${headerH}px)`,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div 
        className="bento-tile tile-main" 
        style={{ 
          padding: 0, 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column',
          transition: 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          height: terminalLayoutMode === 'maximized' ? '0' : 'auto',
          minHeight: terminalLayoutMode === 'maximized' ? '0' : terminalLayoutMode === 'split' ? 'calc((100vh - 96px) / 2)' : '400px',
          overflow: 'hidden',
          opacity: terminalLayoutMode === 'maximized' ? 0 : 1,
          pointerEvents: terminalLayoutMode === 'maximized' ? 'none' : 'auto'
        }}
      >

        {/* ────── Toolbar ────── */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '8px 1.5rem',
          borderBottom: '2px solid var(--color-black)',
          background: '#f9f9f9',
          zIndex: 20,
          flexShrink: 0
        }}>
          
          {/* ... existing toolbar content ... */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button 
              onClick={() => setFileExplorerOpen(!isFileExplorerOpen)}
              style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: 0, opacity: 0.7 }}
              title="Toggle File Explorer"
            >
              {isFileExplorerOpen ? '📁' : '📂'}
            </button>

            {activePath ? (
              <span style={{ fontFamily: 'var(--font-header)', fontWeight: 900, fontSize: '0.9rem', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {activePath.split('/').pop().toUpperCase()}
                <span style={{ fontWeight: 400, color: '#999', fontSize: '0.7rem' }}>— {activePath}</span>
              </span>
            ) : (
              <span style={{ fontFamily: 'var(--font-header)', fontWeight: 900, fontSize: '0.9rem', letterSpacing: '-0.02em', color: '#aaa' }}>NO FILE OPEN</span>
            )}

            {sessionId && (
              isReplaying ? (
                <button onClick={goToLive} style={{ height: '22px', padding: '0 8px', fontFamily: 'var(--font-number)', fontWeight: 700, fontSize: '0.58rem', color: '#2d5bff', background: 'transparent', border: '1.5px solid #2d5bff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  Snapshot #{currentSnapshotIndex + 1}
                </button>
              ) : (
                <span style={{ height: '22px', display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--font-number)', fontWeight: 700, fontSize: '0.58rem', color: '#999' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#c1ff72' }} /> LIVE
                </span>
              )
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {sessionId && (
              <div 
                onClick={() => {
                  navigator.clipboard.writeText(sessionId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', height: '28px', 
                  background: '#eee', border: '1px dashed #aaa', borderRadius: '4px',
                  cursor: 'pointer', transition: 'all 0.15s ease',
                  userSelect: 'none',
                  position: 'relative'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#e8e8e8'; e.currentTarget.style.borderColor = '#999'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#eee'; e.currentTarget.style.borderColor = '#aaa'; }}
                title="Click to copy Session ID"
              >
                <span style={{ fontSize: '0.5rem', fontWeight: 900, color: userRole === 'owner' ? '#16a34a' : '#6366f1' }}>{userRole?.toUpperCase()}</span>
                <span style={{ fontSize: '0.6rem', fontWeight: 900, color: '#777', minWidth: '50px' }}>
                  {copied ? 'COPIED!' : `ID: ${sessionId?.substring(0,6)}`}
                </span>
                {!copied && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2.5" style={{ opacity: 0.8 }}>
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                  </svg>
                )}
              </div>
            )}
            <button onClick={runCode} disabled={isRunning} style={{ height: H, padding: '0 20px', fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '0.7rem', background: isRunning ? '#eee' : '#c1ff72', border: '2px solid #080808', cursor: isRunning ? 'not-allowed' : 'pointer' }}>
              {isRunning ? 'RUNNING...' : '▶ RUN'}
            </button>
          </div>
        </div>

        {/* ────── Main Content Area ────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {isFileExplorerOpen && (
            <div style={{ width: '260px', flexShrink: 0, position: 'relative', borderRight: '1px solid #ddd' }}>
              <FileExplorer onToggle={() => setFileExplorerOpen(false)} />
            </div>
          )}

          <div style={{ flex: 1, position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {activePath ? (
              <div style={{ flex: 1, position: 'relative' }}>
                <ImpactWarningBanner />
                <MonacoEditor />
              </div>
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
