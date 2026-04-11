/* -------------------------------------------------------
 * MonacoEditor.jsx — Code Editor with Real-Time Collaboration
 * - Remote cursors
 * - Dark blue line highlights for remote edits (viewer only)
 * - Custom hover card showing change details + root analysis
 * ------------------------------------------------------- */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import useEditorStore from '../../store/useEditorStore';
import { sendCodeChange, sendCursorPosition } from '../../services/socket';

const MonacoEditor = () => {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const cursorDecorationsRef = useRef([]);
  const changeDecorationsRef = useRef([]);
  const hoverTimeoutRef = useRef(null);
  const wrapperRef = useRef(null);

  // Hover card state
  const [hoverInfo, setHoverInfo] = useState(null); // { x, y, change, line }

  const code = useEditorStore((s) => s.code);
  const setCode = useEditorStore((s) => s.setCode);
  const language = useEditorStore((s) => s.language);
  const isReplaying = useEditorStore((s) => s.isReplaying);
  const sessionId = useEditorStore((s) => s.sessionId);
  const currentUser = useEditorStore((s) => s.currentUser);
  const activePath = useEditorStore((s) => s.activePath);
  const runCode = useEditorStore((s) => s.runCode);
  const remoteCursors = useEditorStore((s) => s.remoteCursors);
  const remoteLineChanges = useEditorStore((s) => s.remoteLineChanges);

  /* ── Format timestamp ── */
  const formatTimeAgo = (ts) => {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  /* ── Editor Mount ── */
  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.editor.defineTheme('avant-garde-organic', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '888888', fontStyle: 'italic' },
        { token: 'keyword', foreground: '000000', fontStyle: 'bold' },
        { token: 'string', foreground: '2d5bff' },
        { token: 'number', foreground: 'ff3e3e' },
        { token: 'type', foreground: '000000', fontStyle: 'bold' },
        { token: 'function', foreground: '2d5bff', fontStyle: 'bold' },
        { token: 'variable', foreground: '080808' },
      ],
      colors: {
        'editor.background': '#fdfcf8',
        'editor.foreground': '#080808',
        'editor.lineHighlightBackground': '#f8f6f0',
        'editor.selectionBackground': '#2d5bff33',
        'editorCursor.foreground': '#000000',
        'editor.selectionHighlightBackground': '#2d5bff22',
        'editorLineNumber.foreground': '#aaaaaa',
        'editorLineNumber.activeForeground': '#000000',
        'editorGutter.background': '#fdfcf8',
      },
    });
    monaco.editor.setTheme('avant-garde-organic');

    editor.addAction({
      id: 'run-code',
      label: 'Run Code',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => handleRun(),
    });

    // Ctrl+S → Save current file
    editor.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        const state = useEditorStore.getState();
        if (state.sessionId && state.activePath) {
          import('../../services/api').then(({ saveFile }) => {
            saveFile(state.sessionId, state.activePath, state.code)
              .then(() => console.log('[Causify] File saved from editor:', state.activePath))
              .catch((err) => console.error('[Causify] Save failed:', err));
          });
        }
      },
    });

    // Send cursor position
    editor.onDidChangeCursorPosition((e) => {
      if (sessionId && currentUser) {
        sendCursorPosition(sessionId, currentUser.id, {
          line: e.position.lineNumber,
          column: e.position.column,
          path: useEditorStore.getState().activePath,
          username: currentUser.username,
          color: currentUser.color || '#6366f1',
        });
      }
    });

    // ── Mouse move: show/hide custom hover card ──
    editor.onMouseMove((e) => {
      const hideHover = () => {
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = null;
        }
        setHoverInfo(null);
      };

      if (!e.target || !e.target.position) {
        hideHover();
        return;
      }

      const line = e.target.position.lineNumber;
      const currentPathNow = useEditorStore.getState().activePath;
      const changesNow = useEditorStore.getState().remoteLineChanges[currentPathNow];

      if (changesNow && changesNow[line]) {
        // Line has a remote change
        if (hoverInfo && hoverInfo.line === line) {
          // Already showing this line, do nothing
          return;
        }

        // Moving to a new changed line or first time seeing a change
        // Clear any pending timeout for a previous line
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }

        hoverTimeoutRef.current = setTimeout(() => {
          const change = changesNow[line];
          setHoverInfo({
            x: e.event.posx,
            y: e.event.posy,
            change,
            line,
          });
          hoverTimeoutRef.current = null;
        }, 150); // Small intentional delay before showing
      } else {
        hideHover();
      }
    });

    // Monaco onMouseLeave — hide card
    editor.onMouseLeave(() => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      setHoverInfo(null);
    });

    // Click outside colored lines → clear all highlights
    editor.onMouseDown((e) => {
      if (!e.target || !e.target.position) return;
      const line = e.target.position.lineNumber;
      const currentPathNow = useEditorStore.getState().activePath;
      const changesNow = useEditorStore.getState().remoteLineChanges[currentPathNow];
      
      // If clicked on a non-highlighted line, clear ALL remote highlights for this file
      // Also clear if clicking while NO hover card is active (intentional dismissal)
      if (!changesNow || !changesNow[line] || !hoverInfo) {
        useEditorStore.getState().clearRemoteLineChanges(currentPathNow);
        setHoverInfo(null);
      }
    });

    // Dismiss hover card when user starts typing
    editor.onDidChangeModelContent(() => {
      setHoverInfo(null);
    });

    // Dismiss hover card on cursor movement (keyboard nav)
    editor.onDidChangeCursorSelection(() => {
      setHoverInfo(null);
    });

  }, [sessionId, currentUser]);

  /* ── Remote cursor decorations ── */
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const currentPath = useEditorStore.getState().activePath;
    const newDecorations = [];

    const model = editor.getModel();
    const lineCount = model ? model.getLineCount() : 0;

    Object.entries(remoteCursors).forEach(([userId, cursor]) => {
      if (cursor.path !== currentPath) return;
      const line = Math.max(1, Math.min(cursor.line || 1, lineCount));
      if (lineCount === 0) return;

      newDecorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: `remote-cursor-line-${userId.replace(/[^a-zA-Z0-9]/g, '')}`,
          linesDecorationsClassName: 'remote-cursor-glyph',
          overviewRuler: {
            color: cursor.color || '#6366f1',
            position: monaco.editor.OverviewRulerLane.Full,
          },
          after: {
            content: ` ◄ ${cursor.username || userId}`,
            inlineClassName: 'remote-cursor-label',
          },
        },
      });
    });

    cursorDecorationsRef.current = editor.deltaDecorations(
      cursorDecorationsRef.current,
      newDecorations
    );
  }, [remoteCursors]);

  /* ── Remote line-change decorations (dark blue bg + white text) ── */
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const currentPath = useEditorStore.getState().activePath;
    const pathChanges = remoteLineChanges[currentPath];
    const newDecorations = [];

    // Clean up old dynamic styles
    document.querySelectorAll('[id^="rc-style-"]').forEach(el => el.remove());

    if (pathChanges && Object.keys(pathChanges).length > 0) {
      const styleEl = document.createElement('style');
      styleEl.id = 'rc-style-all';

      let cssText = `
        .rc-line-bg {
          background-color: #152d4a !important;
        }
        .rc-line-white-text {
          color: #ffffff !important;
        }
      `;

      const model = editor.getModel();
      const lineCount = model ? model.getLineCount() : 0;

      Object.entries(pathChanges).forEach(([lineStr, change]) => {
        const line = parseInt(lineStr, 10);
        if (isNaN(line) || !change) return;

        // Guard: skip lines that exceed the current model's line count
        if (line < 1 || line > lineCount) return;

        const maxCol = model.getLineMaxColumn(line);

        // Decoration 1: whole-line dark blue background
        newDecorations.push({
          range: new monaco.Range(line, 1, line, maxCol),
          options: {
            isWholeLine: true,
            className: 'rc-line-bg',
          },
        });

        // Decoration 2: inline white text covering the full line content
        newDecorations.push({
          range: new monaco.Range(line, 1, line, maxCol),
          options: {
            inlineClassName: 'rc-line-white-text',
          },
        });
      });

      styleEl.textContent = cssText;
      document.head.appendChild(styleEl);
    }

    changeDecorationsRef.current = editor.deltaDecorations(
      changeDecorationsRef.current,
      newDecorations
    );
  }, [remoteLineChanges, activePath]);

  /* ── Cleanup on unmount ── */
  useEffect(() => {
    return () => {
      document.querySelectorAll('[id^="rc-style-"]').forEach(el => el.remove());
    };
  }, []);

  const handleCodeChange = useCallback((value) => {
    if (!isReplaying) {
      setCode(value || '');
      if (sessionId && currentUser) {
        sendCodeChange(sessionId, currentUser.id, activePath, value || '');
      }
    }
  }, [isReplaying, setCode, sessionId, currentUser, activePath]);

  const handleRun = useCallback(async () => {
    runCode();
  }, [runCode]);

  /* ── Custom Hover Card — Neo-Brutalist Theme ── */
  const renderHoverCard = () => {
    if (!hoverInfo) return null;
    const { x, y, change, line } = hoverInfo;
    const timeAgo = formatTimeAgo(change.timestamp);
    const timeStr = new Date(change.timestamp).toLocaleTimeString();

    const cardW = 340;
    const cardH = 320;
    const showAbove = y + cardH + 20 > window.innerHeight;

    // Type-specific accent color
    const typeAccent =
      change.type === 'added' ? '#c1ff72' :
      change.type === 'removed' ? '#ff3e3e' : '#2d5bff';

    const cardStyle = {
      position: 'fixed',
      left: Math.max(8, Math.min(x + 16, window.innerWidth - cardW - 16)),
      top: showAbove
        ? Math.max(8, y - cardH - 10)
        : Math.min(y + 20, window.innerHeight - cardH - 8),
      zIndex: 99999,
      width: `${cardW}px`,
      background: '#fdfcf8',
      color: '#080808',
      border: '4px solid #080808',
      boxShadow: `6px 6px 0px ${typeAccent}`,
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      fontSize: '12px',
      pointerEvents: 'none',
      overflow: 'hidden',
      maxHeight: '90vh',
    };

    return (
      <div style={cardStyle}>
        {/* Top accent bar */}
        <div style={{
          height: '4px',
          background: `linear-gradient(90deg, ${typeAccent}, #080808)`,
        }} />

        {/* Header */}
        <div style={{
          background: '#080808',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <div style={{
            width: '28px', height: '28px',
            background: typeAccent,
            border: '2px solid #080808',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '13px', fontWeight: 900, color: '#080808', flexShrink: 0,
            fontFamily: "'Syne', sans-serif",
          }}>
            {(change.username || '?')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 800, fontSize: '13px', color: '#fff',
              textTransform: 'uppercase', letterSpacing: '-0.02em',
            }}>
              {change.username}
            </div>
            <div style={{
              fontFamily: "'Unbounded', sans-serif",
              fontSize: '9px', color: '#888', marginTop: '2px',
              fontWeight: 700,
            }}>
              LINE {line} • {timeAgo.toUpperCase()}
            </div>
          </div>
          <div style={{
            fontFamily: "'Unbounded', sans-serif",
            padding: '3px 8px', fontSize: '9px',
            fontWeight: 900, letterSpacing: '0.05em',
            background: typeAccent,
            color: '#080808',
            border: '2px solid #080808',
          }}>
            {change.type.toUpperCase()}
          </div>
        </div>

        {/* Details row */}
        <div style={{
          display: 'flex', gap: '0',
          borderBottom: '2px solid #080808',
        }}>
          <div style={{
            flex: 1, padding: '8px 14px',
            borderRight: '2px solid #080808',
          }}>
            <div style={{
              fontFamily: "'Unbounded', sans-serif",
              fontSize: '8px', fontWeight: 900, color: '#888',
              letterSpacing: '0.1em', marginBottom: '2px',
            }}>TYPE</div>
            <div style={{
              fontFamily: "'Unbounded', sans-serif",
              fontWeight: 900, fontSize: '11px',
            }}>{change.type.toUpperCase()}</div>
          </div>
          <div style={{ flex: 1, padding: '8px 14px' }}>
            <div style={{
              fontFamily: "'Unbounded', sans-serif",
              fontSize: '8px', fontWeight: 900, color: '#888',
              letterSpacing: '0.1em', marginBottom: '2px',
            }}>WHEN</div>
            <div style={{
              fontFamily: "'Unbounded', sans-serif",
              fontWeight: 900, fontSize: '11px',
            }}>{timeStr}</div>
          </div>
        </div>

        {/* Before / After diffs */}
        {change.type !== 'added' && (
          <div style={{ padding: '8px 14px 4px' }}>
            <div style={{
              fontFamily: "'Unbounded', sans-serif",
              fontSize: '9px', fontWeight: 900, color: '#ff3e3e',
              letterSpacing: '0.05em', marginBottom: '4px',
            }}>⊖ BEFORE</div>
            <div style={{
              background: '#fff',
              border: '2px solid #080808',
              padding: '6px 8px', fontSize: '11px',
              fontFamily: "'Unbounded', monospace", fontWeight: 700,
              color: '#080808',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              maxHeight: '50px', overflow: 'auto',
              borderLeft: '4px solid #ff3e3e',
            }}>
              {change.oldLine}
            </div>
          </div>
        )}
        {change.type !== 'removed' && (
          <div style={{ padding: '4px 14px 8px' }}>
            <div style={{
              fontFamily: "'Unbounded', sans-serif",
              fontSize: '9px', fontWeight: 900, color: '#16a34a',
              letterSpacing: '0.05em', marginBottom: '4px',
            }}>⊕ AFTER</div>
            <div style={{
              background: '#fff',
              border: '2px solid #080808',
              padding: '6px 8px', fontSize: '11px',
              fontFamily: "'Unbounded', monospace", fontWeight: 700,
              color: '#080808',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              maxHeight: '50px', overflow: 'auto',
              borderLeft: '4px solid #c1ff72',
            }}>
              {change.newLine}
            </div>
          </div>
        )}

        {/* Root Analysis */}
        <div style={{
          margin: '4px 14px 12px',
          background: '#080808',
          border: '2px solid #080808',
          borderLeft: `4px solid ${typeAccent}`,
          padding: '8px 10px',
          fontSize: '11px',
          lineHeight: '1.5',
          color: '#ccc',
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}>
          <span style={{
            fontFamily: "'Unbounded', sans-serif",
            fontWeight: 900, fontSize: '9px',
            color: typeAccent, letterSpacing: '0.05em',
          }}>ROOT ANALYSIS </span>
          <br />
          {change.type === 'modified' && (
            <>Line {line} was modified by <strong style={{ color: '#fff' }}>{change.username}</strong>. Content was replaced at {timeStr}.</>
          )}
          {change.type === 'added' && (
            <>New line inserted by <strong style={{ color: '#fff' }}>{change.username}</strong> at position {line} at {timeStr}.</>
          )}
          {change.type === 'removed' && (
            <>Line removed by <strong style={{ color: '#fff' }}>{change.username}</strong> at {timeStr}. Original content deleted.</>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="monaco-wrapper"
      ref={wrapperRef}
      style={{ height: '100%', position: 'relative' }}
      onMouseLeave={() => {
        // Failsafe: if mouse leaves the entire editor wrapper, always hide
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        setHoverInfo(null);
      }}
    >
      {isReplaying && (
        <div className="editor-actions">
           <div className="tech-label">[REPLAY_MODE]</div>
        </div>
      )}

      <Editor
        height="100%"
        language={language}
        value={code}
        onChange={handleCodeChange}
        onMount={handleEditorMount}
        options={{
          fontSize: 16,
          fontFamily: "'Unbounded', monospace",
          minimap: { enabled: false },
          padding: { top: 8 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          renderLineHighlight: 'all',
          readOnly: isReplaying,
          wordWrap: 'on',
          lineNumbers: 'on',
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 5,
          lineNumbersMinChars: 3,
          scrollbar: {
            vertical: 'visible',
            horizontal: 'visible',
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            useShadows: false,
            verticalHasArrows: false,
            horizontalHasArrows: false
          }
        }}
      />

      {/* Custom hover card rendered as fixed overlay */}
      {renderHoverCard()}

      <style>{`
        .remote-cursor-glyph {
          background: #6366f1;
          width: 2px !important;
          margin-left: 3px;
          border-radius: 0;
        }
        .remote-cursor-label {
          color: #fff;
          font-size: 10px;
          font-weight: 800;
          font-family: var(--font-number), monospace;
          background: #6366f1;
          padding: 1px 6px;
          margin-left: 6px;
          letter-spacing: 0.03em;
          vertical-align: middle;
        }
      `}</style>
    </div>
  );
};

export default MonacoEditor;
