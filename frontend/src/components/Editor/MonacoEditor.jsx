/* -------------------------------------------------------
 * MonacoEditor.jsx — Code Editor with Real-Time Collaboration
 * - Remote cursors
 * - Dark blue line highlights for remote edits (viewer only)
 * - Custom hover card showing change details + root analysis
 * ------------------------------------------------------- */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import useEditorStore from '../../store/useEditorStore';
import { sendCodeChange, sendCursorPosition, sendFollowState } from '../../services/socket';

const MonacoEditor = () => {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const cursorDecorationsRef = useRef([]);
  const changeDecorationsRef = useRef([]);
  const hoverTimeoutRef = useRef(null);
  const wrapperRef = useRef(null);
  const collisionTimerRef = useRef(null);

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

  // Follow mode
  const followingUserId = useEditorStore((s) => s.followingUserId);
  const followedByUsers = useEditorStore((s) => s.followedByUsers);
  const followState = useEditorStore((s) => s.followState);
  const stopFollowing = useEditorStore((s) => s.stopFollowing);
  const connectedUsers = useEditorStore((s) => s.connectedUsers);
  const followDecorationsRef = useRef([]);
  const isFollowScrollingRef = useRef(false);

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

    monaco.editor.defineTheme('debugsync-intelligence', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '5A5A5A', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'B3B3B3' },
        { token: 'string', foreground: 'C7FF5E' },
        { token: 'number', foreground: 'FFB224' },
        { token: 'type', foreground: '7EE0FF' },
        { token: 'function', foreground: 'EDEDED', fontStyle: 'bold' },
        { token: 'variable', foreground: 'D4D4D4' },
        { token: 'identifier', foreground: 'D4D4D4' },
        { token: 'delimiter', foreground: '8A8A8A' },
        { token: 'operator', foreground: '9A9A9A' },
      ],
      colors: {
        'editor.background': '#0A0A0A',
        'editor.foreground': '#D4D4D4',
        'editor.lineHighlightBackground': '#141414',
        'editor.selectionBackground': '#FFFFFF26',
        'editorCursor.foreground': '#FFFFFF',
        'editor.selectionHighlightBackground': '#FFFFFF14',
        'editorLineNumber.foreground': '#3E3E3E',
        'editorLineNumber.activeForeground': '#A0A0A0',
        'editorGutter.background': '#0A0A0A',
        'editorIndentGuide.background': '#1C1C1C',
        'editorIndentGuide.activeBackground': '#2E2E2E',
        'editorWhitespace.foreground': '#222222',
        'editorBracketMatch.background': '#FFFFFF1A',
        'editorBracketMatch.border': '#FFFFFF55',
        'scrollbarSlider.background': '#FFFFFF18',
        'scrollbarSlider.hoverBackground': '#FFFFFF4D',
        'scrollbarSlider.activeBackground': '#FFFFFF80',
        'editorWidget.background': '#171717',
        'editorWidget.border': '#2E2E2E',
        'editorSuggestWidget.background': '#171717',
        'editorSuggestWidget.border': '#2E2E2E',
        'editorSuggestWidget.selectedBackground': '#202020',
        'editorHoverWidget.background': '#171717',
        'editorHoverWidget.border': '#2E2E2E',
      },
    });
    monaco.editor.setTheme('debugsync-intelligence');

    editor.addAction({
      id: 'run-code',
      label: 'Run Code',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => handleRun(),
    });

    // Capture CodeShot — right-click context menu + Ctrl+Shift+K
    editor.addAction({
      id: 'capture-codeshot',
      label: 'Capture CodeShot',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK,
      ],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      precondition: 'editorHasSelection',
      run: (ed) => {
        const selection = ed.getSelection();
        if (!selection || selection.isEmpty()) return;

        const model = ed.getModel();
        if (!model) return;

        const selectedText = model.getValueInRange(selection);
        const state = useEditorStore.getState();
        const now = new Date();

        state.openCodeShotModal({
          code: selectedText,
          language: state.language || 'plaintext',
          filePath: state.activePath || 'untitled',
          startLine: selection.startLineNumber,
          endLine: selection.endLineNumber,
          branch: state.gitRepoConnected ? (state.gitStatus?.match?.(/On branch (\S+)/)?.[1] || '—') : '—',
          timestamp: now.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        });
      },
    });

    // Ctrl+S → Save (silent re-save if handle exists, else open OS Save dialog)
    editor.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: async () => {
        const state = useEditorStore.getState();
        const path = state.activePath;
        const content = state.code;
        if (!path) return;

        const { saveFileAs, saveFileToHandle } = await import('../../services/fileSave');

        const existingHandle = state.fileHandles[path];
        if (existingHandle) {
          // Silent re-save to the same location
          const ok = await saveFileToHandle(existingHandle, content);
          if (ok) {
            state.markFileSaved(path, content);
            console.log('[Causify] Saved silently:', path);
          } else {
            // Handle invalidated — fall through to Save As
            const result = await saveFileAs(path.split('/').pop(), content);
            if (result) {
              if (result.handle) state.setFileHandle(path, result.handle);
              state.markFileSaved(path, content);
              state.setFileSavedPath(path, result.name);
            }
          }
        } else {
          // First save — open OS Save dialog
          const result = await saveFileAs(path.split('/').pop(), content);
          if (result) {
            if (result.handle) state.setFileHandle(path, result.handle);
            state.markFileSaved(path, content);
            state.setFileSavedPath(path, result.name);
          }
        }

        // Also persist to backend session
        if (state.sessionId) {
          const { saveFile } = await import('../../services/api');
          saveFile(state.sessionId, path, content).catch((err) =>
            console.error('[Causify] Backend save failed:', err)
          );
        }
      },
    });

    // Ctrl+Shift+S → Save As (always opens OS Save dialog)
    editor.addAction({
      id: 'save-file-as',
      label: 'Save File As',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS],
      run: async () => {
        const state = useEditorStore.getState();
        const path = state.activePath;
        const content = state.code;
        if (!path) return;

        const { saveFileAs } = await import('../../services/fileSave');
        const result = await saveFileAs(path.split('/').pop(), content);
        if (result) {
          if (result.handle) state.setFileHandle(path, result.handle);
          state.markFileSaved(path, content);
          state.setFileSavedPath(path, result.name);
          console.log('[Causify] Saved As:', result.name);
        }

        // Also persist to backend session
        if (state.sessionId) {
          const { saveFile } = await import('../../services/api');
          saveFile(state.sessionId, path, content).catch((err) =>
            console.error('[Causify] Backend save failed:', err)
          );
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

    // ── Follow Mode: broadcast editor state when we have followers ──
    editor.onDidScrollChange((e) => {
      const store = useEditorStore.getState();
      if (store.followedByUsers.length > 0 && store.sessionId && store.currentUser) {
        sendFollowState(store.sessionId, {
          leaderId: store.currentUser.id,
          leaderUsername: store.currentUser.username,
          leaderColor: store.currentUser.color || '#6366f1',
          file: store.activePath,
          scrollTop: e.scrollTop,
          cursorLine: editor.getPosition()?.lineNumber || 1,
          cursorColumn: editor.getPosition()?.column || 1,
          selectionRange: editor.getSelection() ? {
            startLine: editor.getSelection().startLineNumber,
            startColumn: editor.getSelection().startColumn,
            endLine: editor.getSelection().endLineNumber,
            endColumn: editor.getSelection().endColumn,
          } : null,
        });
      }

      // Auto-exit follow mode on local scroll (not triggered by follow sync)
      if (store.followingUserId && !isFollowScrollingRef.current) {
        store.stopFollowing();
        store.setFollowToast('Follow mode exited — you scrolled');
      }
    });

    // Auto-exit follow mode on local typing
    editor.onDidChangeModelContent((e) => {
      const store = useEditorStore.getState();
      if (store.followingUserId && e.changes.length > 0) {
        // Only exit if the change is local (not from follow state sync)
        const isLocal = e.changes.some(c => !c.forceMoveMarkers);
        if (isLocal) {
          store.stopFollowing();
          store.setFollowToast('Follow mode exited — you started editing');
        }
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

    // Intercept model content changes for concurrency checks & dismiss hover card
    editor.onDidChangeModelContent((e) => {
      setHoverInfo(null);

      // Only check collision for local user text typing edits (when editor has focus)
      if (!editor.hasTextFocus()) return;

      const activePathNow = useEditorStore.getState().activePath;
      const remoteCursors = useEditorStore.getState().remoteCursors;

      let collision = false;
      let collidingUser = '';
      let collidingLine = 0;

      for (const change of e.changes) {
        for (const [userId, cursor] of Object.entries(remoteCursors)) {
          if (cursor && cursor.path === activePathNow) {
            const cursorLine = cursor.line;
            // Check if remote user is active on the edited line
            if (cursorLine >= change.range.startLineNumber && cursorLine <= change.range.endLineNumber) {
              collision = true;
              collidingUser = cursor.username || 'Another user';
              collidingLine = cursorLine;
              break;
            }
          }
        }
        if (collision) break;
      }

      if (collision) {
        // Block and revert the edit
        setTimeout(() => {
          editor.trigger('keyboard', 'undo', null);
        }, 0);

        // Display warning banner
        const setCollisionWarning = useEditorStore.getState().setCollisionWarning;
        setCollisionWarning({ line: collidingLine, username: collidingUser });

        // Auto-dismiss warning banner after 3 seconds
        if (collisionTimerRef.current) clearTimeout(collisionTimerRef.current);
        collisionTimerRef.current = setTimeout(() => {
          useEditorStore.getState().setCollisionWarning(null);
        }, 3000);
      }
    });

    // Dismiss hover card on cursor movement (keyboard nav)
    // Also track selection state for the toolbar CodeShot button
    editor.onDidChangeCursorSelection((e) => {
      setHoverInfo(null);

      const selection = editor.getSelection();
      const model = editor.getModel();
      if (selection && !selection.isEmpty() && model) {
        const selectedText = model.getValueInRange(selection);
        useEditorStore.getState().setEditorSelection({
          code: selectedText,
          startLine: selection.startLineNumber,
          endLine: selection.endLineNumber,
        });
      } else {
        useEditorStore.getState().setEditorSelection(null);
      }
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

    // Clean up old cursor style tags
    document.querySelectorAll('[id^="rc-cursor-style-"]').forEach(el => el.remove());

    const styleEl = document.createElement('style');
    styleEl.id = 'rc-cursor-style-all';
    let cssText = '';

    Object.entries(remoteCursors).forEach(([userId, cursor]) => {
      if (cursor.path !== currentPath) return;
      const line = Math.max(1, Math.min(cursor.line || 1, lineCount));
      if (lineCount === 0) return;

      const cleanUserId = userId.replace(/[^a-zA-Z0-9]/g, '');
      const rawColor = cursor.color || '#6366f1';
      
      let userColor = rawColor;
      if (rawColor.toLowerCase() === '#c7ff5e' || rawColor.toLowerCase() === '#3dd68c' || rawColor.toLowerCase() === '#00ff00' || rawColor.toLowerCase() === 'var(--lime)') {
        userColor = '#FF2E93'; // Map owner green to neon pink/magenta
      }

      cssText += `
        .remote-cursor-line-${cleanUserId} {
          border-left: 2px solid ${userColor} !important;
        }
        .remote-cursor-glyph-${cleanUserId} {
          background-color: ${userColor} !important;
          width: 2px !important;
          margin-left: 3px;
        }
        .remote-cursor-label-${cleanUserId} {
          background-color: ${userColor} !important;
        }
      `;

      newDecorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: `remote-cursor-line-${cleanUserId}`,
          linesDecorationsClassName: `remote-cursor-glyph-${cleanUserId}`,
          overviewRuler: {
            color: userColor,
            position: monaco.editor.OverviewRulerLane.Full,
          },
          after: {
            content: ` ◄ ${cursor.username || userId}`,
            inlineClassName: `remote-cursor-label remote-cursor-label-${cleanUserId}`,
          },
        },
      });
    });

    if (cssText) {
      styleEl.textContent = cssText;
      document.head.appendChild(styleEl);
    }

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
          background-color: rgba(179, 179, 179, 0.12) !important;
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

  /* ── Follow Mode: react to incoming leader state ── */
  useEffect(() => {
    if (!followState || !followingUserId) {
      // Clear follow decorations when not following
      if (editorRef.current && followDecorationsRef.current.length > 0) {
        followDecorationsRef.current = editorRef.current.deltaDecorations(
          followDecorationsRef.current, []
        );
      }
      return;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    // 1. Switch to the leader's file if different
    if (followState.file && followState.file !== activePath) {
      const store = useEditorStore.getState();
      if (store.files[followState.file]) {
        store.openFile(followState.file);
      }
    }

    // 2. Sync scroll position (prevent auto-exit by marking it)
    if (followState.scrollTop !== undefined) {
      isFollowScrollingRef.current = true;
      editor.setScrollTop(followState.scrollTop);
      // Reset flag after a small delay
      setTimeout(() => { isFollowScrollingRef.current = false; }, 200);
    }

    // 3. Show leader cursor + selection as decorations
    const newDecorations = [];

    if (followState.cursorLine) {
      newDecorations.push({
        range: new monaco.Range(followState.cursorLine, 1, followState.cursorLine, 1),
        options: {
          isWholeLine: false,
          linesDecorationsClassName: 'follow-leader-cursor',
          after: {
            content: ` ◄ ${followState.leaderUsername || 'Leader'}`,
            inlineClassName: 'remote-cursor-label',
          },
          overviewRuler: {
            color: followState.leaderColor || '#FFFFFF',
            position: monaco.editor.OverviewRulerLane.Full,
          },
        },
      });
    }

    if (followState.selectionRange) {
      const sel = followState.selectionRange;
      if (sel.startLine !== sel.endLine || sel.startColumn !== sel.endColumn) {
        newDecorations.push({
          range: new monaco.Range(sel.startLine, sel.startColumn, sel.endLine, sel.endColumn),
          options: {
            className: 'follow-leader-selection',
          },
        });
      }
    }

    followDecorationsRef.current = editor.deltaDecorations(
      followDecorationsRef.current,
      newDecorations
    );
  }, [followState, followingUserId, activePath]);

  /* ── Follow Mode: broadcast cursor/selection changes to followers ── */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (followedByUsers.length === 0) return;

    const store = useEditorStore.getState();
    if (!store.sessionId || !store.currentUser) return;

    // Broadcast current state on cursor selection change
    sendFollowState(store.sessionId, {
      leaderId: store.currentUser.id,
      leaderUsername: store.currentUser.username,
      leaderColor: store.currentUser.color || '#6366f1',
      file: activePath,
      scrollTop: editor.getScrollTop(),
      cursorLine: editor.getPosition()?.lineNumber || 1,
      cursorColumn: editor.getPosition()?.column || 1,
      selectionRange: editor.getSelection() ? {
        startLine: editor.getSelection().startLineNumber,
        startColumn: editor.getSelection().startColumn,
        endLine: editor.getSelection().endLineNumber,
        endColumn: editor.getSelection().endColumn,
      } : null,
    });
  }, [followedByUsers, activePath, code]);

  /* ── Cleanup on unmount ── */
  useEffect(() => {
    return () => {
      document.querySelectorAll('[id^="rc-style-"]').forEach(el => el.remove());
      if (collisionTimerRef.current) clearTimeout(collisionTimerRef.current);
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

  /* ── Custom Hover Card — Intelligence Card ── */
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
      change.type === 'added' ? '#FFFFFF' :
      change.type === 'removed' ? '#E5484D' : '#B3B3B3';

    const cardStyle = {
      position: 'fixed',
      left: Math.max(8, Math.min(x + 16, window.innerWidth - cardW - 16)),
      top: showAbove
        ? Math.max(8, y - cardH - 10)
        : Math.min(y + 20, window.innerHeight - cardH - 8),
      zIndex: 99999,
      width: `${cardW}px`,
      background: '#0F0F0F',
      color: '#EDEDED',
      border: '1px dotted #484848',
      borderRadius: '3px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      fontFamily: "var(--font-body)",
      fontSize: '11px',
      pointerEvents: 'none',
      overflow: 'hidden',
      maxHeight: '90vh',
    };

    return (
      <div style={cardStyle}>
        {/* Header */}
        <div style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderBottom: '1px dotted #2E2E2E',
        }}>
          <div style={{
            width: '24px', height: '24px',
            border: '1px dotted #6E6E6E',
            borderRadius: '2px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '10px', fontWeight: 600, color: '#EDEDED', flexShrink: 0,
            fontFamily: "'Space Grotesk', sans-serif",
          }}>
            {(change.username || '?')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 600, fontSize: '12px', color: '#EDEDED',
            }}>
              {change.username}
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '8px', color: '#6E6E6E', marginTop: '1px',
              letterSpacing: '0.04em',
            }}>
              LINE {line} · {timeAgo.toUpperCase()}
            </div>
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            padding: '1px 6px', fontSize: '8px',
            fontWeight: 600, letterSpacing: '0.04em',
            color: '#A0A0A0',
            border: '1px dotted #484848',
            borderRadius: '2px',
          }}>
            {change.type.toUpperCase()}
          </div>
        </div>

        {/* Before / After diffs */}
        {change.type !== 'added' && (
          <div style={{ padding: '8px 12px 2px' }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '8px', fontWeight: 600, color: '#888888',
              letterSpacing: '0.05em', marginBottom: '2px',
            }}>BEFORE</div>
            <div style={{
              background: '#070707',
              border: '1px dotted #2E2E2E',
              borderRadius: '2px',
              padding: '5px 8px', fontSize: '10px',
              fontFamily: "'JetBrains Mono', monospace",
              color: '#A0A0A0',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              maxHeight: '44px', overflow: 'auto',
            }}>
              {change.oldLine}
            </div>
          </div>
        )}
        {change.type !== 'removed' && (
          <div style={{ padding: '4px 12px 8px' }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '8px', fontWeight: 600, color: '#888888',
              letterSpacing: '0.05em', marginBottom: '2px',
            }}>AFTER</div>
            <div style={{
              background: '#070707',
              border: '1px dotted #2E2E2E',
              borderRadius: '2px',
              padding: '5px 8px', fontSize: '10px',
              fontFamily: "'JetBrains Mono', monospace",
              color: '#EDEDED',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              maxHeight: '44px', overflow: 'auto',
            }}>
              {change.newLine}
            </div>
          </div>
        )}

        {/* Root Analysis */}
        <div style={{
          margin: '2px 12px 10px',
          background: '#070707',
          border: '1px dotted #2E2E2E',
          borderRadius: '2px',
          padding: '6px 8px',
          fontSize: '10px',
          lineHeight: '1.4',
          color: '#888888',
          fontFamily: "var(--font-body)",
        }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 600, fontSize: '8px',
            color: '#A0A0A0', letterSpacing: '0.06em',
          }}>ANALYSIS //</span>{' '}
          {change.type === 'modified' && (
            <>Line {line} modified by <strong>{change.username}</strong> at {timeStr}.</>
          )}
          {change.type === 'added' && (
            <>Line {line} inserted by <strong>{change.username}</strong> at {timeStr}.</>
          )}
          {change.type === 'removed' && (
            <>Line {line} deleted by <strong>{change.username}</strong> at {timeStr}.</>
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
           <div style={{
             display: 'inline-flex',
             alignItems: 'center',
             gap: '6px',
             color: '#38BDF8',
             fontFamily: 'var(--font-number)',
             fontSize: '0.62rem',
             fontWeight: 700,
             letterSpacing: '0.12em',
             userSelect: 'none',
             opacity: 0.9,
           }}>
             <span style={{
               width: '4px',
               height: '4px',
               borderRadius: '50%',
               background: '#38BDF8',
             }} />
             REPLAY MODE
           </div>
        </div>
      )}

      <Editor
        height="100%"
        language={language}
        value={code}
        onChange={handleCodeChange}
        onMount={handleEditorMount}
        options={{
          fontSize: 14,
          fontFamily: "'JetBrains Mono', monospace",
          fontLigatures: true,
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
            vertical: 'hidden',
            horizontal: 'hidden',
            verticalScrollbarSize: 0,
            horizontalScrollbarSize: 0,
            useShadows: false,
            verticalHasArrows: false,
            horizontalHasArrows: false
          }
        }}
      />

      {/* Custom hover card rendered as fixed overlay */}
      {renderHoverCard()}

      {/* Follow mode banner */}
      {followingUserId && (() => {
        const leader = connectedUsers.find(u => u.id === followingUserId);
        return leader ? (
          <div className="follow-banner" style={{
            position: 'absolute',
            top: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '5px 14px',
            background: 'rgba(10, 10, 10, 0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '999px',
            animation: 'fadeIn 0.2s ease-out',
            cursor: 'pointer',
          }} onClick={() => { stopFollowing(); useEditorStore.getState().setFollowToast('Follow mode exited'); }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ animation: 'speaking-pulse 2s ease-in-out infinite' }}>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.58rem',
              fontWeight: 600,
              letterSpacing: '0.06em',
              color: '#FFFFFF',
            }}>
              Following {leader.username}
            </span>
            <span style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.48rem',
              color: 'var(--t3)',
              letterSpacing: '0.04em',
            }}>
              click to exit
            </span>
          </div>
        ) : null;
      })()}

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
        .follow-leader-cursor {
          background: rgba(255, 255, 255, 0.6);
          width: 2px !important;
          margin-left: 3px;
        }
        .follow-leader-selection {
          background: rgba(255, 255, 255, 0.08) !important;
          border-left: 2px solid rgba(255, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
};

export default MonacoEditor;
