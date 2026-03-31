/* -------------------------------------------------------
 * MonacoEditor.jsx — Code Editor with Real-Time Collaboration
 * Shows remote cursors, live editing indicators, and
 * change notifications when others modify code.
 * ------------------------------------------------------- */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import useEditorStore from '../../store/useEditorStore';
import { sendCodeChange, sendCursorPosition } from '../../services/socket';

// Color palette for remote users
const USER_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4'];

const MonacoEditor = () => {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationsRef = useRef([]);
  const cursorIntervalRef = useRef(null);

  const code = useEditorStore((s) => s.code);
  const setCode = useEditorStore((s) => s.setCode);
  const language = useEditorStore((s) => s.language);
  const isReplaying = useEditorStore((s) => s.isReplaying);
  const sessionId = useEditorStore((s) => s.sessionId);
  const currentUser = useEditorStore((s) => s.currentUser);
  const activePath = useEditorStore((s) => s.activePath);
  const runCode = useEditorStore((s) => s.runCode);
  const remoteCursors = useEditorStore((s) => s.remoteCursors);
  const changeNotifications = useEditorStore((s) => s.changeNotifications);

  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Avant-Garde Organic Theme
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

    // Send cursor position on cursor change
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
  }, [sessionId, currentUser]);

  // Render remote cursors as decorations in Monaco
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const currentPath = useEditorStore.getState().activePath;
    const newDecorations = [];

    Object.entries(remoteCursors).forEach(([userId, cursor]) => {
      if (cursor.path !== currentPath) return;
      const line = cursor.line || 1;
      const col = cursor.column || 1;

      // Cursor line highlight
      newDecorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: `remote-cursor-line-${userId.replace(/[^a-zA-Z0-9]/g, '')}`,
          linesDecorationsClassName: `remote-cursor-glyph`,
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

    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      newDecorations
    );
  }, [remoteCursors]);

  const handleCodeChange = useCallback((value) => {
    if (!isReplaying) {
      setCode(value || '');
      // Broadcast change to other users
      if (sessionId && currentUser) {
        sendCodeChange(sessionId, currentUser.id, activePath, value || '');
      }
    }
  }, [isReplaying, setCode, sessionId, currentUser, activePath]);

  const handleRun = useCallback(async () => {
    runCode();
  }, [runCode]);

  return (
    <div className="monaco-wrapper" style={{ height: '100%', position: 'relative' }}>
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
          padding: { top: 60 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          renderLineHighlight: 'all',
          readOnly: isReplaying,
          wordWrap: 'on',
          lineNumbers: 'on',
          glyphMargin: true,
          folding: true,
          lineDecorationsWidth: 10,
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

      {/* Remote cursor inline styles */}
      <style>{`
        .remote-cursor-glyph {
          background: #6366f1;
          width: 3px !important;
          margin-left: 3px;
          border-radius: 1px;
        }
        .remote-cursor-label {
          color: #6366f1;
          font-size: 11px;
          font-weight: 700;
          font-family: var(--font-number), monospace;
          opacity: 0.8;
          padding-left: 4px;
        }
      `}</style>

      {/* Change Notification Toasts */}
      <div style={{
        position: 'absolute', top: '12px', right: '12px', zIndex: 100,
        display: 'flex', flexDirection: 'column', gap: '6px',
        pointerEvents: 'none', maxWidth: '280px',
      }}>
        {changeNotifications.map((notif) => (
          <div
            key={notif.id}
            style={{
              background: '#080808',
              color: '#fff',
              padding: '8px 14px',
              borderLeft: `4px solid ${notif.color || '#6366f1'}`,
              fontFamily: 'var(--font-number)',
              fontSize: '0.65rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              animation: 'slide-in-right 0.3s ease-out',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              pointerEvents: 'auto',
            }}
          >
            <span style={{
              width: '20px', height: '20px', borderRadius: '50%',
              background: notif.color || '#6366f1',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.6rem', flexShrink: 0,
            }}>
              ✎
            </span>
            <div>
              <div style={{ color: notif.color || '#6366f1', marginBottom: '2px' }}>
                {(notif.username || 'Someone').toUpperCase()}
              </div>
              <div style={{ opacity: 0.7, fontWeight: 500 }}>
                edited {notif.fileName || 'a file'}
              </div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default MonacoEditor;
