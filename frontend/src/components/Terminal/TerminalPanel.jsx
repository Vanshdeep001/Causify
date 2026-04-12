/* -------------------------------------------------------
 * TerminalPanel.jsx — Bottom-Docked Terminal Panel
 * Fixed to viewport bottom. Drag handle to resize.
 * Maximize / Restore / Close controls in the navbar.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useRef } from 'react';
import useEditorStore from '../../store/useEditorStore';
import OutputPanel from '../Output/OutputPanel';
import TimelineSlider from '../Timeline/TimelineSlider';
import CausalityGraph from '../Graph/CausalityGraph';
import GitAssistantPanel from './GitAssistantPanel';

const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;
const NAVBAR_H = 40;

const TerminalPanel = () => {
  const isTerminalOpen = useEditorStore((s) => s.isTerminalOpen);
  const terminalHeight = useEditorStore((s) => s.terminalHeight);
  const terminalLayoutMode = useEditorStore((s) => s.terminalLayoutMode);
  const activeTab = useEditorStore((s) => s.terminalActiveTab);
  const error = useEditorStore((s) => s.error);
  const snapshots = useEditorStore((s) => s.snapshots);
  const userRole = useEditorStore((s) => s.userRole);
  const commitSuggestion = useEditorStore((s) => s.commitSuggestion);
  const detectedProjects = useEditorStore((s) => s.detectedProjects);

  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const setTerminalHeight = useEditorStore((s) => s.setTerminalHeight);
  const setTerminalLayoutMode = useEditorStore((s) => s.setTerminalLayoutMode);
  const toggleTerminal = useEditorStore((s) => s.toggleTerminal);

  const [isResizing, setIsResizing] = useState(false);
  const prevHeightRef = useRef(DEFAULT_HEIGHT);

  // Red dot badge on TIMELINE tab when error exists and not already viewing timeline
  const showTimelineBadge =
    Boolean(error && error.trim()) && snapshots.length > 0 && activeTab !== 'timeline';

  // ── Maximize / Split / Normal Logic ──
  const handleMaximize = () => {
    if (terminalLayoutMode === 'maximized') {
      setTerminalLayoutMode('normal');
      setTerminalHeight(prevHeightRef.current);
    } else {
      prevHeightRef.current = terminalHeight;
      setTerminalLayoutMode('maximized');
    }
  };

  const handleSplit = () => {
    if (terminalLayoutMode === 'split') {
      setTerminalLayoutMode('normal');
      setTerminalHeight(prevHeightRef.current);
    } else {
      prevHeightRef.current = terminalHeight;
      setTerminalLayoutMode('split');
    }
  };

  const currentHeight =
    terminalLayoutMode === 'maximized' ? 'calc(100vh - 48px)' :
      terminalLayoutMode === 'split' ? 'calc((100vh - 48px) / 2)' :
        `${terminalHeight}px`;

  // ── Resize drag ───────────────────────────────────────
  useEffect(() => {
    const onMove = (e) => {
      if (!isResizing) return;
      const newH = window.innerHeight - e.clientY;
      if (newH >= MIN_HEIGHT && newH <= window.innerHeight - 80) {
        setTerminalHeight(newH);
        setTerminalLayoutMode('normal');
      }
    };
    const onUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
    };
    if (isResizing) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'row-resize';
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizing, setTerminalHeight, setTerminalLayoutMode]);

  if (!isTerminalOpen) return null;

  /* ── Shared icon-button style ─────── */
  const iconBtn = (color = '#888', isActive = false) => ({
    width: '26px', height: '26px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '0.65rem',
    background: isActive ? color : 'transparent', color: isActive ? '#000' : color,
    border: `1.5px solid ${color}`,
    cursor: 'pointer', flexShrink: 0,
    transition: 'background 0.12s, color 0.12s',
    lineHeight: 1,
    borderRadius: '2px'
  });

  const tabBtn = (isActive) => ({
    height: NAVBAR_H + 'px', padding: '0 24px',
    fontFamily: 'var(--font-number)', fontWeight: 800, fontSize: '0.7rem',
    color: isActive ? '#c1ff72' : '#666',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer', letterSpacing: '0.15em',
    textTransform: 'uppercase',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  return (
    <div
      style={{
        position: 'fixed', bottom: 0, left: 0, width: '100%',
        height: currentHeight,
        background: '#111', color: '#fff',
        borderTop: '2px solid #333',
        display: 'flex', flexDirection: 'column',
        zIndex: 1000,
        animation: 'slide-up 0.25s ease',
        overflow: 'hidden',
        transition: isResizing ? 'none' : 'height 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* ── Drag handle ── */}
      <div
        onMouseDown={() => setIsResizing(true)}
        style={{
          height: '5px', cursor: 'row-resize', flexShrink: 0,
          background: 'transparent',
        }}
        title="Drag to resize"
      />

      {/* ── Navbar ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '120px 1fr 120px', alignItems: 'center',
        height: `${NAVBAR_H}px`, flexShrink: 0,
        borderBottom: '1px solid #222',
      }}>
        {/* Left Side (Empty/Logo) */}
        <div style={{ paddingLeft: '12px', opacity: 0.5 }}>
          <div style={{ width: '4px', height: '4px', background: '#333' }} />
        </div>

        {/* Tabs (Centered) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '10px' }}>
          {['output', 'timeline', 'graph', 'git']
            .filter(t => t !== 'timeline' || userRole === 'owner')
            .map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTerminalActiveTab(t);
                }}
                style={tabBtn(activeTab === t)}
              >
                {t === 'output' ? 'Output' : t === 'timeline' ? 'Timeline' : t === 'graph' ? 'Graph' : 'Git'}

                {/* Active Indicator Underline */}
                <div style={{
                  position: 'absolute', bottom: '0', left: '50%',
                  width: activeTab === t ? '40%' : '0%', height: '2px',
                  background: '#c1ff72', transform: 'translateX(-50%)',
                  transition: 'width 0.3s ease',
                  boxShadow: activeTab === t ? '0 0 10px #c1ff72' : 'none'
                }} />

                {t === 'timeline' && showTimelineBadge && (
                  <span style={{
                    marginLeft: '6px',
                    fontFamily: 'var(--font-number)', fontWeight: 900,
                    fontSize: '0.4rem', letterSpacing: '0.05em',
                    color: '#fff', background: '#ff3e3e',
                    padding: '1px 4px', borderRadius: '2px',
                    lineHeight: 1.2,
                    boxShadow: '0 0 6px rgba(255,62,62,0.5)',
                    animation: 'pulse-live 1.5s ease-in-out infinite',
                  }}>ERR</span>
                )}

                {t === 'git' && commitSuggestion && (
                  <span style={{
                    marginLeft: '6px',
                    fontFamily: 'var(--font-number)', fontWeight: 900,
                    fontSize: '0.5rem',
                    color: '#000', background: '#c1ff72',
                    width: '14px', height: '14px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '3px', lineHeight: 1,
                    boxShadow: '0 0 8px rgba(193,255,114,0.5)',
                    animation: 'pulse-live 2s ease-in-out infinite',
                  }}>!</span>
                )}
              </button>
            ))}
        </div>

        {/* Window controls (Right Aligned) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', paddingRight: '12px' }}>

          {/* Split ◓ */}
          <button
            onClick={handleSplit}
            title={terminalLayoutMode === 'split' ? 'Restore' : 'Split View'}
            style={iconBtn('#888', terminalLayoutMode === 'split')}
            onMouseEnter={e => { if (terminalLayoutMode !== 'split') { e.currentTarget.style.background = '#888'; e.currentTarget.style.color = '#fff'; } }}
            onMouseLeave={e => { if (terminalLayoutMode !== 'split') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888'; } }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="12" x2="21" y2="12" /></svg>
          </button>

          {/* Maximize □ */}
          <button
            onClick={handleMaximize}
            title={terminalLayoutMode === 'maximized' ? 'Restore' : 'Maximize'}
            style={iconBtn('#888', terminalLayoutMode === 'maximized')}
            onMouseEnter={e => { if (terminalLayoutMode !== 'maximized') { e.currentTarget.style.background = '#888'; e.currentTarget.style.color = '#fff'; } }}
            onMouseLeave={e => { if (terminalLayoutMode !== 'maximized') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888'; } }}
          >
            {terminalLayoutMode === 'maximized' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>
            )}
          </button>

          {/* Close ✕ */}
          <button
            onClick={toggleTerminal}
            title="Close terminal"
            style={iconBtn('#555')}
            onMouseEnter={e => { e.currentTarget.style.background = '#ff3e3e'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#ff3e3e'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = '#555'; }}
          >
            ✕
          </button>
        </div>
      </div>


      <div style={{ flex: 1, overflow: activeTab === 'graph' ? 'hidden' : 'auto', padding: activeTab === 'graph' ? 0 : '16px 20px', minHeight: 0 }}>
        {activeTab === 'output' && <OutputPanel />}
        {activeTab === 'timeline' && <TimelineSlider />}
        {activeTab === 'graph' && <CausalityGraph />}
        {activeTab === 'git' && <GitAssistantPanel />}
      </div>
    </div>
  );
};

export default TerminalPanel;
