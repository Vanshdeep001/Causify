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
import HtmlPreview from '../Preview/HtmlPreview';

const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT     = 120;
const NAVBAR_H       = 40;

const TerminalPanel = () => {
  const isTerminalOpen = useEditorStore((s) => s.isTerminalOpen);
  const terminalHeight = useEditorStore((s) => s.terminalHeight);
  const activeTab      = useEditorStore((s) => s.terminalActiveTab);
  const error          = useEditorStore((s) => s.error);
  const snapshots      = useEditorStore((s) => s.snapshots);
  const userRole       = useEditorStore((s) => s.userRole);

  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const setTerminalHeight    = useEditorStore((s) => s.setTerminalHeight);
  const toggleTerminal       = useEditorStore((s) => s.toggleTerminal);

  const [isResizing,   setIsResizing]   = useState(false);
  const [isMaximized,  setIsMaximized]  = useState(false);
  const [isMinimized,  setIsMinimized]  = useState(false);
  const prevHeightRef = useRef(DEFAULT_HEIGHT);

  // Red dot badge on TIMELINE tab when error exists and not already viewing timeline
  const showTimelineBadge =
    Boolean(error && error.trim()) && snapshots.length > 0 && activeTab !== 'timeline';

  // ── Maximize ──────────────────────────────────────────
  const handleMaximize = () => {
    if (isMaximized) {
      // Restore
      setTerminalHeight(prevHeightRef.current);
      setIsMaximized(false);
      setIsMinimized(false);
    } else {
      prevHeightRef.current = terminalHeight;
      setTerminalHeight(Math.round(window.innerHeight * 0.72));
      setIsMaximized(true);
      setIsMinimized(false);
    }
  };

  // ── Minimize ──────────────────────────────────────────
  const handleMinimize = () => {
    if (isMinimized) {
      // Restore
      setTerminalHeight(prevHeightRef.current);
      setIsMinimized(false);
    } else {
      prevHeightRef.current = terminalHeight;
      setTerminalHeight(NAVBAR_H);
      setIsMinimized(true);
      setIsMaximized(false);
    }
  };

  // ── Resize drag ───────────────────────────────────────
  useEffect(() => {
    const onMove = (e) => {
      if (!isResizing) return;
      const newH = window.innerHeight - e.clientY;
      if (newH >= MIN_HEIGHT && newH <= window.innerHeight - 80) {
        setTerminalHeight(newH);
        setIsMaximized(false);
        setIsMinimized(false);
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
  }, [isResizing, setTerminalHeight]);

  // Reset maximized/minimized if terminal is toggled externally
  useEffect(() => {
    if (!isTerminalOpen) { setIsMaximized(false); setIsMinimized(false); }
  }, [isTerminalOpen]);

  if (!isTerminalOpen) return null;

  /* ── Shared icon-button style ─────── */
  const iconBtn = (color = '#888') => ({
    width: '26px', height: '26px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--font-number)', fontWeight: 900, fontSize: '0.65rem',
    background: 'transparent', color,
    border: `1.5px solid ${color}`,
    cursor: 'pointer', flexShrink: 0,
    transition: 'background 0.12s, color 0.12s',
    lineHeight: 1,
  });

  const tabBtn = (isActive) => ({
    height: NAVBAR_H + 'px', padding: '0 16px',
    fontFamily: 'var(--font-number)', fontWeight: 700, fontSize: '0.65rem',
    color: isActive ? '#fff' : '#666',
    background: 'transparent',
    border: 'none',
    borderBottom: isActive ? '2px solid #c1ff72' : '2px solid transparent',
    cursor: 'pointer', letterSpacing: '0.05em',
    transition: 'color 0.12s, border-color 0.12s',
    position: 'relative',
  });

  return (
    <div
      style={{
        position: 'fixed', bottom: 0, left: 0, width: '100%',
        height: `${terminalHeight}px`,
        background: '#111', color: '#fff',
        borderTop: '2px solid #333',
        display: 'flex', flexDirection: 'column',
        zIndex: 1000,
        animation: 'slide-up 0.25s ease',
        overflow: 'hidden',
        transition: 'height 0.2s ease',
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
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: `${NAVBAR_H}px`, flexShrink: 0,
        borderBottom: '1px solid #222', paddingRight: '12px',
      }}>

        {/* Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          {['output', 'timeline', 'graph', 'preview']
            .filter(t => t !== 'timeline' || userRole === 'owner')
            .map((t) => (
            <button
              key={t}
              onClick={() => {
                setTerminalActiveTab(t);
                // If panel is minimized (navbar only), restore to default height
                if (isMinimized || terminalHeight <= NAVBAR_H) {
                  setTerminalHeight(DEFAULT_HEIGHT);
                  setIsMinimized(false);
                }
              }}
              style={tabBtn(activeTab === t)}
            >
              {t === 'output' ? '[ OUTPUT ]' : t === 'timeline' ? '[ TIMELINE ]' : t === 'graph' ? '[ GRAPH ]' : '[ PREVIEW ]'}
              {t === 'timeline' && showTimelineBadge && (
                <span style={{
                  position: 'absolute', top: '8px', right: '6px',
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: '#ff3e3e', boxShadow: '0 0 5px #ff3e3e',
                  animation: 'pulse-live 1.2s ease-in-out infinite',
                }} />
              )}
            </button>
          ))}
        </div>

        {/* Window controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>

          {/* Minimize ▬ */}
          <button
            onClick={handleMinimize}
            title={isMinimized ? 'Restore' : 'Minimize'}
            style={iconBtn('#666')}
            onMouseEnter={e => { e.currentTarget.style.background = '#666'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#666'; }}
          >
            {isMinimized ? '↑' : '—'}
          </button>

          {/* Maximize □ */}
          <button
            onClick={handleMaximize}
            title={isMaximized ? 'Restore' : 'Maximize'}
            style={iconBtn('#888')}
            onMouseEnter={e => { e.currentTarget.style.background = '#888'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#888'; }}
          >
            {isMaximized ? '⊡' : '□'}
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

      {/* ── Content ── */}
      {!isMinimized && (
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', minHeight: 0 }}>
          {activeTab === 'output'   && <OutputPanel />}
          {activeTab === 'timeline' && <TimelineSlider />}
          {activeTab === 'graph'    && <div style={{ position: 'relative', height: '100%' }}><CausalityGraph /></div>}
          {activeTab === 'preview'  && <HtmlPreview />}
        </div>
      )}
    </div>
  );
};

export default TerminalPanel;
