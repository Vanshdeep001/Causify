/* -------------------------------------------------------
 * TerminalPanel.jsx — Bottom-Docked Terminal Panel
 * Fixed to viewport bottom. Drag handle to resize.
 * Maximize / Restore / Close controls in the navbar.
 * ------------------------------------------------------- */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import useEditorStore from '../../store/useEditorStore';
import OutputPanel from '../Output/OutputPanel';
import TimelineSlider from '../Timeline/TimelineSlider';
import CausalityGraph from '../Graph/CausalityGraph';
import GitAssistantPanel from './GitAssistantPanel';
import XTermTab from './XTermTab';
import DeployHub from '../Deploy/DeployHub';

const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;
const NAVBAR_H = 32;
// How much of the editor stays visible at maximum drag, so there is always
// something to grab when dragging back down.
const MIN_EDITOR_VISIBLE = 80;

const TerminalPanel = () => {
  const isTerminalOpen = useEditorStore((s) => s.isTerminalOpen);
  const terminalHeight = useEditorStore((s) => s.terminalHeight);
  const terminalLayoutMode = useEditorStore((s) => s.terminalLayoutMode);
  const activeTab = useEditorStore((s) => s.terminalActiveTab);
  const terminalSecondActiveTab = useEditorStore((s) => s.terminalSecondActiveTab);
  const error = useEditorStore((s) => s.error);
  const snapshots = useEditorStore((s) => s.snapshots);
  const userRole = useEditorStore((s) => s.userRole);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  // The timeline is the owner's view of a session's history — and, for a folder
  // opened from disk, simply your own history. A collaborator still doesn't get
  // it, but working solo is not the same as being a collaborator.
  const canSeeTimeline = userRole === 'owner' || Boolean(workspaceRoot);
  const commitSuggestion = useEditorStore((s) => s.commitSuggestion);
  const detectedProjects = useEditorStore((s) => s.detectedProjects);
  const deployStatus = useEditorStore((s) => s.deployStatus);
  const renderDeployStatus = useEditorStore((s) => s.renderDeployStatus);

  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const setTerminalSecondActiveTab = useEditorStore((s) => s.setTerminalSecondActiveTab);
  const setTerminalHeight = useEditorStore((s) => s.setTerminalHeight);
  const setTerminalLayoutMode = useEditorStore((s) => s.setTerminalLayoutMode);
  const toggleTerminal = useEditorStore((s) => s.toggleTerminal);
  const projectRootPath = useEditorStore((s) => s.projectRootPath);

  const [isResizing, setIsResizing] = useState(false);
  const prevHeightRef = useRef(DEFAULT_HEIGHT);
  // Used to measure the space the panel's container actually offers, so the
  // resize limit tracks the real layout rather than the whole viewport.
  const panelRef = useRef(null);

  // ── Terminal instance management ──
  const [termSessions, setTermSessions] = useState([]); // [{ id, label }]
  const [activeTermIdx, setActiveTermIdx] = useState(0);
  const termIdCounter = useRef(0);

  // Create a new terminal session
  const addTerminalSession = useCallback(() => {
    termIdCounter.current += 1;
    const newSession = {
      id: `term-${termIdCounter.current}`,
      label: `Terminal ${termIdCounter.current}`,
    };
    setTermSessions((prev) => {
      const updated = [...prev, newSession];
      setActiveTermIdx(updated.length - 1);
      return updated;
    });
    // Also switch to terminal tab
    setTerminalActiveTab('terminal');
  }, [setTerminalActiveTab]);

  // Close a terminal session
  const closeTerminalSession = useCallback((idx) => {
    setTermSessions((prev) => {
      const updated = prev.filter((_, i) => i !== idx);
      // Adjust active index
      if (updated.length === 0) {
        setActiveTermIdx(0);
      } else if (activeTermIdx >= updated.length) {
        setActiveTermIdx(updated.length - 1);
      }
      return updated;
    });
  }, [activeTermIdx]);

  // Auto-create first terminal session when switching to terminal tab
  useEffect(() => {
    if (activeTab === 'terminal' && termSessions.length === 0) {
      termIdCounter.current += 1;
      setTermSessions([{ id: `term-${termIdCounter.current}`, label: `Terminal ${termIdCounter.current}` }]);
      setActiveTermIdx(0);
    }
  }, [activeTab]);

  // Red dot badge on TIMELINE tab when error exists and not already viewing timeline
  const showTimelineBadge =
    Boolean(error && error.trim()) && snapshots.length > 0 && activeTab !== 'timeline';

  // Pulsing badge on DEPLOY tab when either target is deploying
  const showDeployBadge =
    (deployStatus === 'deploying' || renderDeployStatus === 'deploying') && activeTab !== 'deploy';

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

  /**
   * Largest height the panel can take: the space its container actually offers,
   * less a sliver of editor. Measured from the container rather than the window,
   * because the panel sits below the app header and toolbars — using the full
   * viewport height overshoots by however tall those are.
   */
  const maxHeightFor = useCallback((bounds) => {
    const available = bounds ? bounds.height : window.innerHeight;
    return Math.max(MIN_HEIGHT, available - MIN_EDITOR_VISIBLE);
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!isResizing) return;

      const parent = panelRef.current?.parentElement;
      const bounds = parent?.getBoundingClientRect();
      const bottom = bounds ? bounds.bottom : window.innerHeight;

      // Clamp rather than ignore. Previously an out-of-range value was dropped
      // entirely, so dragging past the limit froze the panel instead of pinning
      // it to the maximum — which read as "it stops growing".
      const desired = bottom - e.clientY;
      const clamped = Math.min(Math.max(desired, MIN_HEIGHT), maxHeightFor(bounds));

      setTerminalHeight(clamped);
      setTerminalLayoutMode('normal');
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
  }, [isResizing, maxHeightFor, setTerminalHeight, setTerminalLayoutMode]);

  // Shrinking the window can leave a stored height taller than the space now
  // available. Because the panel no longer flex-shrinks, that would overflow
  // instead of adjusting — so bring it back within range.
  useEffect(() => {
    const clampToAvailable = () => {
      const parent = panelRef.current?.parentElement;
      if (!parent) return; // panel is closed — nothing to measure against
      const max = maxHeightFor(parent.getBoundingClientRect());
      if (terminalHeight > max) setTerminalHeight(max);
    };

    // Also run once on mount: a height stored on a larger monitor would
    // otherwise overflow until the user happened to resize the window.
    clampToAvailable();

    window.addEventListener('resize', clampToAvailable);
    return () => window.removeEventListener('resize', clampToAvailable);
  }, [terminalHeight, maxHeightFor, setTerminalHeight]);

  if (!isTerminalOpen) return null;

  /* ── Shared icon-button style ─────── */
  const iconBtn = (isActive = false) => ({
    width: '24px', height: '24px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--font-number)', fontWeight: 500, fontSize: '0.62rem',
    background: isActive ? 'var(--s4)' : 'transparent',
    color: isActive ? 'var(--t1)' : 'var(--t3)',
    border: '1px solid ' + (isActive ? 'var(--line-strong)' : 'var(--line)'),
    cursor: 'pointer', flexShrink: 0,
    transition: 'all 0.15s ease',
    lineHeight: 1,
    borderRadius: '5px'
  });

  const errorBadge = {
    position: 'absolute',
    top: '-3px',
    right: '-3px',
    fontFamily: 'var(--font-number)', fontWeight: 600,
    fontSize: '0.42rem', letterSpacing: '0.05em',
    color: '#fff', background: 'var(--crimson)',
    padding: '1px 4px', borderRadius: '3px',
    lineHeight: 1.3,
    animation: 'pulse-live 1.8s ease-in-out infinite',
    zIndex: 10,
  };

  const tabBtn = (isActive) => ({
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: isActive ? 'var(--lime)' : 'transparent',
    color: isActive ? '#000000' : 'var(--t3)',
    border: isActive ? '1px solid var(--lime)' : '1px solid transparent',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
    boxShadow: isActive ? '0 4px 12px rgba(255, 255, 255, 0.15)' : 'none',
    position: 'relative',
  });

  const tabIcons = {
    output: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="7" y1="8" x2="17" y2="8" />
        <line x1="7" y1="12" x2="17" y2="12" />
        <line x1="7" y1="16" x2="13" y2="16" />
      </svg>
    ),
    terminal: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
    timeline: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    graph: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
    ),
    git: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 15V10a4 4 0 0 0-4-4H9" />
        <line x1="6" y1="9" x2="6" y2="15" />
      </svg>
    ),
    deploy: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" />
      </svg>
    ),
  };

  const tabLabels = {
    output: 'Output',
    terminal: 'Terminal',
    timeline: 'Timeline',
    graph: 'Graph',
    git: 'Git Assistant',
    deploy: 'Deploy',
  };

  const isMaximized = terminalLayoutMode === 'maximized';
  const isSplit = terminalLayoutMode === 'split';

  return (
    <div
      ref={panelRef}
      style={{
        position: isMaximized ? 'absolute' : 'relative',
        top: isMaximized ? 0 : 'auto',
        left: isMaximized ? 0 : 'auto',
        right: isMaximized ? 0 : 'auto',
        bottom: 0,
        width: '100%',
        height: isMaximized ? '100%' : isSplit ? '400px' : `${terminalHeight}px`,
        // The panel is the last child of a flex column. Without this, flexbox
        // shrinks it back as it grows — the height was being set correctly and
        // then quietly undone by the layout, which is why dragging appeared to
        // stop working past a certain size.
        flexShrink: 0,
        background: 'var(--s1)', color: 'var(--t1)',
        borderTop: '1px solid var(--line-strong)',
        display: 'flex', flexDirection: 'column',
        zIndex: isMaximized ? 1000 : 20,
        animation: isMaximized ? 'none' : 'slide-up 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        transition: isResizing ? 'none' : 'height 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* ── Drag handle ── */}
      <div
        onMouseDown={() => setIsResizing(true)}
        style={{
          // A 5px invisible strip was easy to miss. Slightly taller, and it
          // lights up on hover so the panel reads as resizable.
          height: '7px', cursor: 'row-resize', flexShrink: 0,
          background: isResizing ? 'var(--lime)' : 'transparent',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => { if (!isResizing) e.currentTarget.style.background = 'var(--line-strong)'; }}
        onMouseLeave={(e) => { if (!isResizing) e.currentTarget.style.background = 'transparent'; }}
        title="Drag to resize"
      />

      {/* ── Navbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: `${NAVBAR_H}px`, flexShrink: 0,
        borderBottom: '1px solid var(--line)',
        padding: '0 10px',
      }}>
        {/* Tabs (Pane 1) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {['output', 'terminal', 'timeline', 'graph', 'git', 'deploy']
            .filter(t => t !== 'timeline' || canSeeTimeline)
            .map((t) => (
              <button
                key={t}
                onClick={() => setTerminalActiveTab(t)}
                title={tabLabels[t]}
                style={tabBtn(activeTab === t)}
                onMouseEnter={e => { if (activeTab !== t) e.currentTarget.style.color = 'var(--t1)'; }}
                onMouseLeave={e => { if (activeTab !== t) e.currentTarget.style.color = 'var(--t3)'; }}
              >
                {tabIcons[t]}
                {t === 'timeline' && showTimelineBadge && <span style={errorBadge}>ERR</span>}
                {t === 'deploy' && showDeployBadge && <span style={{...errorBadge, background: '#38BDF8'}}>LIVE</span>}
              </button>
            ))}

          {/* Terminal instance sub-tabs + add button */}
          {activeTab === 'terminal' && (
            <>
              <div style={{ width: '1px', height: '16px', background: 'var(--line)', marginLeft: '2px', marginRight: '2px' }} />
              {termSessions.map((session, idx) => (
                <button
                  key={session.id}
                  onClick={() => setActiveTermIdx(idx)}
                  title={session.label}
                  style={{
                    ...tabBtn(activeTermIdx === idx),
                    width: 'auto',
                    padding: '0 6px',
                    fontSize: '0.5rem',
                    fontFamily: 'var(--font-number)',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    gap: '4px',
                    borderRadius: '3px',
                    height: '20px',
                  }}
                  onMouseEnter={e => { if (activeTermIdx !== idx) e.currentTarget.style.color = 'var(--t1)'; }}
                  onMouseLeave={e => { if (activeTermIdx !== idx) e.currentTarget.style.color = 'var(--t3)'; }}
                >
                  {idx + 1}
                  {termSessions.length > 1 && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTerminalSession(idx);
                      }}
                      style={{
                        marginLeft: '2px',
                        fontSize: '0.55rem',
                        color: 'var(--t4)',
                        cursor: 'pointer',
                        lineHeight: 1,
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--crimson)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--t4)'}
                    >
                      ✕
                    </span>
                  )}
                </button>
              ))}
              <button
                onClick={addTerminalSession}
                title="New terminal"
                style={{
                  width: '20px',
                  height: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  color: 'var(--t4)',
                  border: '1px solid var(--line)',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  fontSize: '0.7rem',
                  padding: 0,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--t4)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
              >
                +
              </button>
            </>
          )}
        </div>

        {/* Window controls & Pane 2 Tabs if split */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {terminalLayoutMode === 'split' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', borderRight: '1px solid var(--line)', paddingRight: '10px' }}>
               {['output', 'timeline', 'graph', 'git', 'deploy']
                .filter(t => t !== 'timeline' || canSeeTimeline)
                .map((t) => (
                  <button
                    key={'s-'+t}
                    onClick={() => setTerminalSecondActiveTab(t)}
                    title={tabLabels[t]}
                    style={{
                      ...iconBtn(terminalSecondActiveTab === t),
                      width: 'auto', padding: '0 7px', fontSize: '0.55rem',
                      color: terminalSecondActiveTab === t ? 'var(--lime)' : 'var(--t3)',
                      borderColor: terminalSecondActiveTab === t ? 'var(--lime-line)' : 'var(--line)',
                      background: terminalSecondActiveTab === t ? 'var(--lime-dim)' : 'transparent',
                    }}
                  >
                    {t.substring(0, 1).toUpperCase()}
                  </button>
                ))}
            </div>
          )}

          {/* Split */}
          <button
            onClick={handleSplit}
            title={terminalLayoutMode === 'split' ? 'Restore' : 'Split View'}
            style={iconBtn(terminalLayoutMode === 'split')}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
            onMouseLeave={e => { if (terminalLayoutMode !== 'split') { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'var(--line)'; } }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="12" x2="21" y2="12" /></svg>
          </button>

          {/* Maximize */}
          <button
            onClick={handleMaximize}
            title={terminalLayoutMode === 'maximized' ? 'Restore' : 'Maximize'}
            style={iconBtn(terminalLayoutMode === 'maximized')}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
            onMouseLeave={e => { if (terminalLayoutMode !== 'maximized') { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'var(--line)'; } }}
          >
            {terminalLayoutMode === 'maximized' ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="4" width="12" height="12" rx="1.5" />
                <path d="M4 8v10a2 2 0 0 0 2 2h10" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>
            )}
          </button>

          {/* Close */}
          <button
            onClick={toggleTerminal}
            title="Close terminal"
            style={iconBtn(false)}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--crimson)'; e.currentTarget.style.borderColor = 'rgba(229,72,77,0.4)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'var(--line)'; }}
          >
            ✕
          </button>
        </div>
      </div>


      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        background: 'var(--s0)'
      }}>
        {/* Lpane */}
        <div
          className="no-scrollbar"
          style={{
            flex: 1,
            minWidth: 0,
            overflow: ['graph', 'deploy', 'terminal', 'git'].includes(activeTab) ? 'hidden' : 'auto',
            padding: ['graph', 'output', 'terminal', 'deploy', 'git'].includes(activeTab) ? 0 : '16px 20px',
            borderRight: terminalLayoutMode === 'split' ? '1px solid var(--line-strong)' : 'none',
            position: 'relative'
          }}
        >
          {activeTab === 'output' && <OutputPanel />}
          {activeTab === 'terminal' && termSessions.length > 0 && (
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              {termSessions.map((session, idx) => (
                <div
                  key={session.id}
                  style={{
                    width: '100%',
                    height: '100%',
                    position: idx === activeTermIdx ? 'relative' : 'absolute',
                    top: 0,
                    left: 0,
                    visibility: idx === activeTermIdx ? 'visible' : 'hidden',
                    zIndex: idx === activeTermIdx ? 1 : 0,
                  }}
                >
                  <XTermTab key={session.id} isActive={idx === activeTermIdx} cwd={projectRootPath || undefined} />
                </div>
              ))}
            </div>
          )}
          {activeTab === 'timeline' && <TimelineSlider />}
          {activeTab === 'graph' && <CausalityGraph />}
          {activeTab === 'git' && <GitAssistantPanel />}
          {activeTab === 'deploy' && <DeployHub />}

          {terminalLayoutMode === 'split' && (
            <div style={{ position: 'absolute', top: 0, right: 0, padding: '3px 8px', background: 'var(--s3)', fontSize: '0.5rem', color: 'var(--t3)', fontFamily: 'var(--font-number)', borderRadius: '0 0 0 5px' }}>PANE 1</div>
          )}
        </div>

        {/* Rpane (only if split) */}
        {terminalLayoutMode === 'split' && (
           <div
            className="no-scrollbar"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: ['graph', 'deploy', 'git'].includes(terminalSecondActiveTab) ? 'hidden' : 'auto',
              padding: ['graph', 'output', 'deploy', 'git'].includes(terminalSecondActiveTab) ? 0 : '16px 20px',
              position: 'relative',
              background: 'var(--s0)'
            }}
          >
            {terminalSecondActiveTab === 'output' && <OutputPanel />}
            {terminalSecondActiveTab === 'timeline' && <TimelineSlider />}
            {terminalSecondActiveTab === 'graph' && <CausalityGraph />}
            {terminalSecondActiveTab === 'git' && <GitAssistantPanel />}
            {terminalSecondActiveTab === 'deploy' && <DeployHub />}

            <div style={{ position: 'absolute', top: 0, right: 0, padding: '3px 8px', background: 'var(--lime-dim)', fontSize: '0.5rem', color: 'var(--lime)', fontFamily: 'var(--font-number)', fontWeight: 600, borderRadius: '0 0 0 5px' }}>PANE 2</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TerminalPanel;
