/* -------------------------------------------------------
 * EditorPage.jsx — Main Application Workspace
 * ------------------------------------------------------- */

import React, { useState, useCallback } from 'react';
import MonacoEditor from '../components/Editor/MonacoEditor';
import TerminalPanel from '../components/Terminal/TerminalPanel';
import useEditorStore from '../store/useEditorStore';
import { saveFile } from '../services/api';
import { sendCodeChange } from '../services/socket';

import FileExplorer from '../components/Editor/FileExplorer';
import EmptyEditorState from '../components/Editor/EmptyEditorState';
import ImpactWarningBanner from '../components/Editor/ImpactWarningBanner';

/* ── Language Icon Component ── */
const LanguageIcon = ({ filename, size = 20 }) => {
  if (!filename) return null;
  const ext = filename.split('.').pop()?.toLowerCase();

  const baseStyle = {
    width: size, height: size, display: 'flex', alignItems: 'center',
    justifyContent: 'center', borderRadius: '4px', fontWeight: 900,
    fontSize: size * 0.45, fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    letterSpacing: '-0.02em', flexShrink: 0, lineHeight: 1,
  };

  switch (ext) {
    case 'java':
      return (
        <div style={{ ...baseStyle, background: 'linear-gradient(135deg, #f89820, #e76f00)', color: '#fff', boxShadow: '0 2px 8px rgba(248,152,32,0.4)' }}>
          <svg width={size * 0.65} height={size * 0.65} viewBox="0 0 24 24" fill="#fff">
            <path d="M8.851 18.56s-.917.534.653.714c1.902.218 2.874.187 4.969-.211 0 0 .552.346 1.321.646-4.699 2.013-10.633-.118-6.943-1.149M8.276 15.933s-1.028.762.542.924c2.032.209 3.636.227 6.413-.308 0 0 .384.389.987.602-5.679 1.661-12.007.13-7.942-1.218M13.116 11.475c1.158 1.333-.304 2.533-.304 2.533s2.939-1.518 1.589-3.418c-1.261-1.772-2.228-2.652 3.007-5.688 0 0-8.216 2.051-4.292 6.573M19.33 20.504s.679.559-.747.991c-2.712.822-11.288 1.069-13.669.033-.856-.373.75-.89 1.254-.998.527-.114.828-.093.828-.093-.953-.671-6.156 1.317-2.643 1.887 9.58 1.553 17.462-.7 14.977-1.82M9.292 13.21s-4.362 1.036-1.544 1.412c1.189.159 3.561.123 5.77-.062 1.806-.152 3.618-.477 3.618-.477s-.637.272-1.098.587c-4.429 1.165-12.986.623-10.522-.568 2.082-1.006 3.776-.892 3.776-.892M17.116 17.584c4.503-2.34 2.421-4.589.968-4.285-.356.075-.515.14-.515.14s.132-.207.385-.297c2.875-1.011 5.086 2.981-.929 4.56 0 0 .07-.062.091-.118" />
            <path d="M14.401 .734s2.494 2.494-2.365 6.338c-3.896 3.079-.889 4.836 0 6.838-2.274-2.053-3.943-3.858-2.824-5.541 1.644-2.469 6.197-3.665 5.189-7.635" />
          </svg>
        </div>
      );
    case 'py':
    case 'pyw':
      return (
        <div style={{ ...baseStyle, background: 'linear-gradient(135deg, #3776AB, #FFD43B)', color: '#fff', boxShadow: '0 2px 8px rgba(55,118,171,0.4)' }}>
          <svg width={size * 0.65} height={size * 0.65} viewBox="0 0 24 24" fill="#fff">
            <path d="M11.914 0C5.82 0 6.2 2.656 6.2 2.656l.007 2.752h5.814v.826H3.9S0 5.789 0 11.969c0 6.18 3.403 5.96 3.403 5.96h2.03v-2.867s-.109-3.42 3.35-3.42h5.766s3.24.052 3.24-3.148V3.202S18.28 0 11.914 0zM8.708 1.85c.578 0 1.046.47 1.046 1.05s-.468 1.05-1.046 1.05c-.579 0-1.046-.47-1.046-1.05s.467-1.05 1.046-1.05z" />
            <path d="M12.086 24c6.094 0 5.714-2.656 5.714-2.656l-.007-2.752h-5.814v-.826H20.1s3.9.445 3.9-5.735c0-6.18-3.403-5.96-3.403-5.96h-2.03v2.867s.109 3.42-3.35 3.42H9.451s-3.24-.052-3.24 3.148v5.292S5.72 24 12.086 24zm3.206-1.85c-.578 0-1.046-.47-1.046-1.05s.468-1.05 1.046-1.05c.579 0 1.046.47 1.046 1.05s-.467 1.05-1.046 1.05z" fillOpacity="0.7" />
          </svg>
        </div>
      );
    case 'c':
    case 'h':
      return (
        <div style={{ ...baseStyle, background: 'linear-gradient(135deg, #00599C, #004482)', color: '#fff', boxShadow: '0 2px 8px rgba(0,89,156,0.4)' }}>
          C
        </div>
      );
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return (
        <div style={{ ...baseStyle, background: 'linear-gradient(135deg, #00599C, #659AD2)', color: '#fff', boxShadow: '0 2px 8px rgba(0,89,156,0.4)', fontSize: size * 0.38 }}>
          C++
        </div>
      );
    case 'html':
    case 'htm':
      return (
        <div style={{ ...baseStyle, background: 'linear-gradient(135deg, #e34f26, #f06529)', color: '#fff', boxShadow: '0 2px 8px rgba(227,79,38,0.4)', fontSize: size * 0.35 }}>
          <svg width={size * 0.65} height={size * 0.65} viewBox="0 0 24 24" fill="#fff">
            <path d="M1.5 0h21l-1.91 21.563L11.977 24l-8.565-2.438L1.5 0zm7.031 9.75l-.232-2.718 10.059.003.076-.757.076-.771.076-.758H6.862l.618 6.968h7.769l-.352 3.524-2.921.789-2.886-.789-.198-2.209H6.921l.383 4.29L12 19.016l4.695-1.258.666-7.508H8.531z" />
          </svg>
        </div>
      );
    case 'css':
      return (
        <div style={{ ...baseStyle, background: 'linear-gradient(135deg, #264de4, #2965f1)', color: '#fff', boxShadow: '0 2px 8px rgba(38,77,228,0.4)', fontSize: size * 0.35 }}>
          <svg width={size * 0.65} height={size * 0.65} viewBox="0 0 24 24" fill="#fff">
            <path d="M1.5 0h21l-1.91 21.563L11.977 24l-8.565-2.438L1.5 0zm17.09 4.413L5.41 4.41l.213 2.622 10.125.002-.255 2.716h-6.64l.24 2.573h6.182l-.366 3.523-2.91.804-2.956-.81-.188-2.11h-2.61l.29 3.855L12 19.002l5.355-1.12.83-9.617-8.945-.001.097-.36z" />
          </svg>
        </div>
      );
    case 'js':
      return (
        <div style={{ ...baseStyle, background: '#f7df1e', color: '#323330', boxShadow: '0 2px 8px rgba(247,223,30,0.4)' }}>
          JS
        </div>
      );
    case 'jsx':
      return (
        <div style={{ ...baseStyle, background: 'linear-gradient(135deg, #20232a, #61dafb)', color: '#61dafb', boxShadow: '0 2px 8px rgba(97,218,251,0.3)' }}>
          <svg width={size * 0.7} height={size * 0.7} viewBox="0 0 24 24" fill="#61dafb">
            <circle cx="12" cy="12" r="2.2" />
            <g fill="none" stroke="#61dafb" strokeWidth="1">
              <ellipse cx="12" cy="12" rx="10" ry="4.2" />
              <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)" />
              <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)" />
            </g>
          </svg>
        </div>
      );
    case 'ts':
      return (
        <div style={{ ...baseStyle, background: '#3178c6', color: '#fff', boxShadow: '0 2px 8px rgba(49,120,198,0.4)' }}>
          TS
        </div>
      );
    case 'tsx':
      return (
        <div style={{ ...baseStyle, background: 'linear-gradient(135deg, #3178c6, #61dafb)', color: '#fff', boxShadow: '0 2px 8px rgba(49,120,198,0.3)' }}>
          TX
        </div>
      );
    case 'json':
      return (
        <div style={{ ...baseStyle, background: 'linear-gradient(135deg, #292929, #fbc02d)', color: '#fbc02d', boxShadow: '0 2px 8px rgba(251,192,45,0.3)', fontSize: size * 0.30 }}>
          { }
        </div>
      );
    case 'md':
    case 'mdx':
      return (
        <div style={{ ...baseStyle, background: '#083fa1', color: '#fff', boxShadow: '0 2px 8px rgba(8,63,161,0.4)', fontSize: size * 0.35 }}>
          MD
        </div>
      );
    default:
      return (
        <div style={{ ...baseStyle, background: '#555', color: '#ccc', fontSize: size * 0.38 }}>
          <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="2">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
        </div>
      );
  }
};


const EditorPage = () => {
  const [copied, setCopied] = useState(false);
  const isTerminalOpen = useEditorStore((s) => s.isTerminalOpen);
  const terminalHeight = useEditorStore((s) => s.terminalHeight);
  const isRunning = useEditorStore((s) => s.isRunning);
  const isReplaying = useEditorStore((s) => s.isReplaying);
  const error = useEditorStore((s) => s.error);
  const snapshots = useEditorStore((s) => s.snapshots);
  const currentSnapshotIndex = useEditorStore((s) => s.currentSnapshotIndex);
  const sessionId = useEditorStore((s) => s.sessionId);
  const sessionName = useEditorStore((s) => s.sessionName);
  const isFileExplorerOpen = useEditorStore((s) => s.isFileExplorerOpen);
  const fileActivity = useEditorStore((s) => s.fileActivity);
  const currentUser = useEditorStore((s) => s.currentUser);
  const userRole = useEditorStore((s) => s.userRole);

  const runCode = useEditorStore((s) => s.runCode);
  const goToLive = useEditorStore((s) => s.goToLive);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const setFileExplorerOpen = useEditorStore((s) => s.setFileExplorerOpen);
  const activePath = useEditorStore((s) => s.activePath);
  const code = useEditorStore((s) => s.code);
  const connectedUsers = useEditorStore((s) => s.connectedUsers);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);

  const terminalLayoutMode = useEditorStore((s) => s.terminalLayoutMode);

  const hasError = Boolean(error && error.trim());
  const hasSnapshots = snapshots.length > 0;

  const openReplay = () => setTerminalActiveTab('timeline');

  /* ── Save current file ── */
  const handleSave = useCallback(async () => {
    if (!sessionId || !activePath || isSaving) return;
    setIsSaving(true);
    try {
      const currentCode = useEditorStore.getState().code;
      await saveFile(sessionId, activePath, currentCode);
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1500);
    } catch (err) {
      console.error('[Causify] Save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, activePath, isSaving]);

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
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <LanguageIcon filename={activePath.split('/').pop()} size={22} />
                <span style={{ fontFamily: 'var(--font-header)', fontWeight: 900, fontSize: '0.9rem', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {activePath.split('/').pop().toUpperCase()}
                  <span style={{ fontWeight: 400, color: '#999', fontSize: '0.7rem' }}>— {activePath}</span>
                </span>
                {/* Save Button */}
                {sessionId && (
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    title="Save File (Ctrl+S)"
                    style={{
                      height: '26px', padding: '0 12px',
                      fontFamily: 'var(--font-number)', fontWeight: 800, fontSize: '0.6rem',
                      background: saveFlash ? '#c1ff72' : isSaving ? '#eee' : '#fff',
                      border: '1.5px solid #ccc', borderRadius: '4px',
                      cursor: isSaving ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: '5px',
                      transition: 'all 0.2s ease',
                      color: saveFlash ? '#080808' : '#555',
                      boxShadow: saveFlash ? '0 0 12px rgba(193,255,114,0.5)' : 'none',
                    }}
                    onMouseEnter={e => { if (!isSaving && !saveFlash) e.currentTarget.style.borderColor = '#080808'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#ccc'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" />
                      <polyline points="7 3 7 8 15 8" />
                    </svg>
                    {isSaving ? 'SAVING...' : saveFlash ? 'SAVED ✓' : 'SAVE'}
                  </button>
                )}
              </div>
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
                  {copied ? 'COPIED!' : `ID: ${sessionId?.substring(0, 6)}`}
                </span>
                {!copied && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2.5" style={{ opacity: 0.8 }}>
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
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
