/* -------------------------------------------------------
 * MonacoEditor.jsx — Code Editor with Real-Time Collaboration
 * - Remote cursors
 * - Dark blue line highlights for remote edits (viewer only)
 * - Custom hover card showing change details + root analysis
 * ------------------------------------------------------- */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import useEditorStore from '../../store/useEditorStore';
import { sendCursorPosition, sendFollowState, sendFilePresence } from '../../services/socket';
import { getFileText, createBinding, maybeSeed, schedulePersist, isCollabActive, isApplyingRemote } from '../../services/collabDoc';

/* How soon after a keypress, click or paste an edit must land to count as the
 * user's own. Generous enough to cover a slow frame, far shorter than the gap
 * before any unrelated programmatic rewrite. */
const USER_EDIT_WINDOW_MS = 500;

const MonacoEditor = () => {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const cursorDecorationsRef = useRef([]);
  const changeDecorationsRef = useRef([]);
  const hoverTimeoutRef = useRef(null);
  const wrapperRef = useRef(null);
  const collisionTimerRef = useRef(null);

  // CRDT (Yjs) binding — one active binding for the currently open file
  const bindingRef = useRef(null);
  const [editorReady, setEditorReady] = useState(false);
  const collabReady = useEditorStore((s) => s.collabReady);

  // Hover card state & Line inspector
  const [hoverInfo, setHoverInfo] = useState(null); // { path, change, line, pinned }
  const [inspectorOpen, setInspectorOpen] = useState(false);

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
  const userRole = useEditorStore((s) => s.userRole);

  // Follow mode
  const followingUserId = useEditorStore((s) => s.followingUserId);
  const followedByUsers = useEditorStore((s) => s.followedByUsers);
  const followState = useEditorStore((s) => s.followState);
  const stopFollowing = useEditorStore((s) => s.stopFollowing);
  const connectedUsers = useEditorStore((s) => s.connectedUsers);
  const followDecorationsRef = useRef([]);
  // When the user last did something with their own hands, used to tell an
  // edit they made from one the app made on their behalf.
  const lastUserInputRef = useRef(0);

  // Owner-controlled access: viewers get a read-only editor.
  const canEdit = userRole === 'owner'
    || connectedUsers.find((u) => u.id === currentUser?.id)?.permission !== 'viewer';

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
    setEditorReady(true);

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

        // Local mode: the file has a real location, so save writes there directly
        // instead of prompting for one.
        if (state.workspaceRoot) {
          try {
            await state.writeLocalFile(path, content);
            console.log('[Causify] Saved to disk:', path);
          } catch (err) {
            console.error('[Causify] Disk save failed:', err.message);
          }
          return;
        }

        // Untitled buffer on the desktop: first save chooses a location, later
        // ones write straight to it.
        if (window.electronAPI?.workspace) {
          try {
            await state.saveScratchFile(path, content);
          } catch (err) {
            console.error('[Causify] Save failed:', err.message);
          }
          return;
        }

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

    });

    /* ── Follow Mode: release when YOU take over ──
     *
     * Whether the user took over cannot be judged from the editor's derived
     * state. Following someone into their file rewrites the whole model and
     * resets the scroll position — through the editor's own change and scroll
     * events that is indistinguishable from a person typing and scrolling, so
     * watching those drops you out of follow at the exact moment it starts
     * working.
     *
     * Real input events are unambiguous: they fire only for a human at this
     * keyboard, never for anything the app does to the editor.
     */
    const releaseFollow = (reason) => {
      const store = useEditorStore.getState();
      if (!store.followingUserId) return;
      store.stopFollowing();
      store.setFollowToast(`Follow mode exited — ${reason}`);
    };

    const noteUserInput = () => { lastUserInputRef.current = Date.now(); };
    editor.onKeyDown(noteUserInput);
    editor.onMouseDown(noteUserInput);
    editor.onDidPaste(noteUserInput);

    const dom = editor.getDomNode();
    if (dom) {
      // Wheel is not on Monaco's public event surface, and it also covers
      // dragging the scrollbar, which onMouseDown does not reach.
      dom.addEventListener('wheel', () => {
        noteUserInput();
        releaseFollow('you scrolled');
      }, { passive: true });
      dom.addEventListener('mousedown', noteUserInput, { passive: true });
    }

    editor.onDidChangeModelContent((e) => {
      if (e.changes.length === 0) return;
      // A collaborator's edit arriving over the CRDT is not you taking over.
      if (isApplyingRemote()) return;
      // Nor is the full-model rewrite the editor performs when we switch to
      // the leader's file. An edit you actually made always lands within a few
      // milliseconds of the keypress, click or paste that caused it.
      if (Date.now() - lastUserInputRef.current > USER_EDIT_WINDOW_MS) return;
      releaseFollow('you started editing');
    });

    // ── Click line number in gutter to view edit card ──
    editor.onMouseDown((e) => {
      if (!e.target || !e.target.position) return;
      const line = e.target.position.lineNumber;
      const currentPathNow = useEditorStore.getState().activePath;
      const changesNow = useEditorStore.getState().remoteLineChanges[currentPathNow];

      const targetType = e.target.type;
      const monacoTarget = monacoRef.current?.editor?.MouseTargetType;
      const isGutterClick = !monacoTarget || (
        targetType === monacoTarget.GUTTER_LINE_NUMBERS ||
        targetType === monacoTarget.GUTTER_LINE_DECORATIONS ||
        targetType === monacoTarget.GUTTER_GLYPH_MARGIN
      );

      if (changesNow && changesNow[line] && isGutterClick) {
        setHoverInfo((prev) => {
          if (prev?.pinned && prev.line === line && prev.path === currentPathNow) {
            return null; // Toggle off if clicking the same line number again
          }
          return {
            path: currentPathNow,
            change: changesNow[line],
            line,
            pinned: true,
          };
        });
      }
    });

    // Track selection state for the toolbar CodeShot button
    editor.onDidChangeCursorSelection((e) => {
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

  /* ── Line-change decorations for line numbers ── */
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const currentPath = useEditorStore.getState().activePath;
    const pathChanges = remoteLineChanges[currentPath] || {};
    const newDecorations = [];

    Object.keys(pathChanges).forEach((lineStr) => {
      const lineNum = parseInt(lineStr, 10);
      if (!isNaN(lineNum) && pathChanges[lineStr]) {
        newDecorations.push({
          range: new monaco.Range(lineNum, 1, lineNum, 1),
          options: {
            isWholeLine: false,
            marginClassName: 'has-line-edit',
            linesDecorationsClassName: 'has-line-edit',
          },
        });
      }
    });

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

    // 1. Switch to the leader's file if different.
    //
    // Test for the path being part of the project, not for its content being
    // truthy. A local-mode workspace lists every file up front with a null
    // placeholder and reads contents only on open, so a truthiness check
    // refuses to follow into anything the follower has not already opened
    // themselves — and an empty file would be refused in any mode. openFile
    // handles the lazy read.
    //
    // A path that is not in the map yet is genuinely unknown here (the leader
    // just created it and the sync has not landed). Skipping is right; the
    // leader's next cursor move re-runs this with the file present.
    if (followState.file && followState.file !== activePath) {
      const store = useEditorStore.getState();
      if (Object.prototype.hasOwnProperty.call(store.files, followState.file)) {
        store.openFile(followState.file);
      }
    }

    // 2. Sync scroll position. No flag needed to stop this from reading as a
    //    local scroll — releasing follow keys off the wheel event, and this
    //    does not produce one.
    if (followState.scrollTop !== undefined) {
      editor.setScrollTop(followState.scrollTop);
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

  /* ── CRDT binding: bind the active file's Y.Text to the Monaco model ──
   * Rebinds whenever the open file changes. While bound, Yjs owns text
   * sync (character-level merges, no clobbering, cursor preserved) and
   * mirrors content back into the store so run/save/impact keep working.
   * Disabled during replay (which drives the model directly) and when
   * there's no live session. */
  useEffect(() => {
    // Tear down any previous binding first.
    if (bindingRef.current) {
      bindingRef.current.destroy();
      bindingRef.current = null;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    const active = sessionId && collabReady && !isReplaying && activePath && isCollabActive();
    if (!active) return;

    const ytext = getFileText(activePath);
    if (!ytext) return;

    // Seed FIRST — while files[activePath] still holds the imported/persisted
    // content — so binding never blanks it and the later setCode can't clobber it.
    maybeSeed(activePath);

    bindingRef.current = createBinding(ytext, model, monaco, {
      path: activePath,
      onLocalChange: (p, text) => {
        useEditorStore.getState().setCode(text);
        schedulePersist(p, text);
      },
      onRemoteChange: (p, text, uid) => {
        useEditorStore.getState().updateRemoteFile(p, text, uid);
      },
    });

    // Mirror the freshly-bound Y.Text into the store so the controlled
    // <Editor value> matches the model and never fights the binding. maybeSeed
    // (above) already captured files[activePath], so if this is momentarily
    // empty for a joiner, the deferred seed / incoming sync will refill it.
    useEditorStore.getState().setCode(ytext.toString());

    return () => {
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
    };
  }, [editorReady, collabReady, sessionId, activePath, isReplaying]);

  const handleCodeChange = useCallback((value) => {
    if (isReplaying) return;
    // When a CRDT binding is active it owns sync + the store mirror.
    if (bindingRef.current) return;
    // Local-only mode (no live session): just update local state.
    setCode(value || '');
  }, [isReplaying, setCode]);

  /* ── File presence: announce which file I'm working in ──
   * Re-announces on file switch and whenever the roster changes, so a newly
   * joined peer immediately learns where everyone is. */
  useEffect(() => {
    if (!sessionId || !currentUser || !activePath) return;
    sendFilePresence(sessionId, {
      userId: currentUser.id,
      username: currentUser.username,
      color: currentUser.color || '#6366f1',
      path: activePath,
    });
  }, [sessionId, currentUser, activePath, collabReady, connectedUsers.length]);

  const handleRun = useCallback(async () => {
    runCode();
  }, [runCode]);

  /* ── Line Audit Card (Minimalist Architecture) ── */
  const renderHoverCard = () => {
    if (!hoverInfo) return null;
    if (hoverInfo.path && hoverInfo.path !== activePath) return null; // File-scoped

    const { change, line } = hoverInfo;
    const timeAgo = formatTimeAgo(change.timestamp);
    const timeStr = new Date(change.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const isAdded = change.type === 'added';
    const isRemoved = change.type === 'removed';
    const isModified = change.type === 'modified';

    const typeTag = isAdded ? '+ ADDED' : isRemoved ? '- REMOVED' : '~ MODIFIED';

    // Calculate dynamic vertical Y position aligned with selected line
    let calculatedTop = 16;
    if (editorRef.current && wrapperRef.current) {
      const lineTop = editorRef.current.getTopForLineNumber(line);
      const scrollTop = editorRef.current.getScrollTop();
      const relativeLineTop = lineTop - scrollTop;

      const containerHeight = wrapperRef.current.clientHeight || 500;
      const estimatedCardHeight = 180;
      const maxTop = Math.max(12, containerHeight - estimatedCardHeight - 12);
      calculatedTop = Math.min(Math.max(12, relativeLineTop), maxTop);
    }

    const cardStyle = {
      position: 'absolute',
      top: `${calculatedTop}px`,
      right: '24px',
      zIndex: 99,
      width: '360px',
      background: 'rgba(14, 14, 14, 0.96)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      color: '#EDEDED',
      border: '1px dotted #444444',
      borderRadius: '4px',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65)',
      fontFamily: "var(--font-body)",
      fontSize: '11px',
      pointerEvents: 'auto',
      overflow: 'hidden',
      maxHeight: 'calc(100% - 24px)',
      transition: 'top 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
      animation: 'toast-slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
    };

    const copyToClipboard = (text) => {
      if (navigator.clipboard && text) {
        navigator.clipboard.writeText(text);
      }
    };

    return (
      <div style={cardStyle}>
        {/* Header Rail */}
        <div style={{
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px dotted #2E2E2E',
          background: 'rgba(255, 255, 255, 0.015)'
        }}>
          {/* Identity & Location */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
            {/* Square Mono Avatar */}
            <div style={{
              width: '26px', height: '26px',
              borderRadius: '2px',
              border: '1px dotted #555555',
              background: 'rgba(255, 255, 255, 0.03)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '10.5px', fontWeight: 700, color: '#EDEDED', flexShrink: 0,
              fontFamily: "'Space Grotesk', sans-serif"
            }}>
              {(change.username || '?')[0].toUpperCase()}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700, fontSize: '0.8rem', color: '#EDEDED',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                lineHeight: 1.2
              }}>
                {change.username}
              </div>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.54rem', color: '#8A8A8A',
                letterSpacing: '0.08em', marginTop: '2px'
              }}>
                LINE {line}  ·  {timeAgo.toUpperCase()}
              </div>
            </div>
          </div>

          {/* Type Badge & Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.54rem', fontWeight: 700, letterSpacing: '0.08em',
              padding: '2px 7px', borderRadius: '2px',
              border: '1px dotted #555555',
              background: 'rgba(255, 255, 255, 0.03)',
              color: '#D4D4D4'
            }}>
              {typeTag}
            </span>

            <button
              type="button"
              onClick={() => setHoverInfo(null)}
              title="Close inspector"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8A8A8A',
                cursor: 'pointer',
                padding: '2px 4px',
                fontSize: '11px',
                lineHeight: 1,
                transition: 'color 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#FFFFFF'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#8A8A8A'; }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Code Diff Structural Rail */}
        <div style={{ padding: '10px 12px 12px' }}>
          <div style={{
            borderRadius: '3px',
            border: '1px dotted #2E2E2E',
            background: 'rgba(0,0,0,0.2)',
            overflow: 'hidden'
          }}>
            {/* Header label inside diff container */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 8px',
              borderBottom: '1px dotted #2A2A2A',
              background: 'rgba(255,255,255,0.015)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.5rem', letterSpacing: '0.1em',
              color: '#737373', textTransform: 'uppercase'
            }}>
              <span>LINE {line} AUDIT</span>
              {!isRemoved && change.newLine && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(change.newLine)}
                  style={{
                    background: 'transparent', border: 'none',
                    color: '#8A8A8A', cursor: 'pointer',
                    fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: '0.08em', padding: 0
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#EDEDED'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#8A8A8A'; }}
                >
                  COPY
                </button>
              )}
            </div>

            {/* BEFORE Line Row */}
            {!isAdded && (
              <div style={{
                display: 'flex', alignItems: 'flex-start',
                padding: '4px 0',
                borderBottom: isRemoved ? 'none' : '1px dotted #242424',
                background: 'rgba(0, 0, 0, 0.15)'
              }}>
                <span style={{
                  width: '28px', flexShrink: 0, textAlign: 'right', paddingRight: '8px',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: '0.56rem', color: '#666666',
                  lineHeight: '1.6', userSelect: 'none'
                }}>
                  L{line}
                </span>
                <span style={{
                  width: '16px', flexShrink: 0, textAlign: 'center', color: '#8A8A8A',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: '0.64rem', lineHeight: '1.6'
                }}>
                  −
                </span>
                <code style={{
                  flex: 1, minWidth: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.64rem',
                  lineHeight: '1.6', color: '#8A8A8A', opacity: 0.85,
                  wordBreak: 'break-all', whiteSpace: 'pre-wrap', paddingRight: '8px'
                }}>
                  {change.oldLine || '(empty)'}
                </code>
              </div>
            )}

            {/* AFTER Line Row */}
            {!isRemoved && (
              <div style={{
                display: 'flex', alignItems: 'flex-start',
                padding: '4px 0',
                background: 'rgba(255, 255, 255, 0.015)'
              }}>
                <span style={{
                  width: '28px', flexShrink: 0, textAlign: 'right', paddingRight: '8px',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: '0.56rem', color: '#666666',
                  lineHeight: '1.6', userSelect: 'none'
                }}>
                  L{line}
                </span>
                <span style={{
                  width: '16px', flexShrink: 0, textAlign: 'center', color: '#EDEDED',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: '0.64rem', lineHeight: '1.6'
                }}>
                  +
                </span>
                <code style={{
                  flex: 1, minWidth: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.64rem',
                  lineHeight: '1.6', color: '#EDEDED', fontWeight: 500,
                  wordBreak: 'break-all', whiteSpace: 'pre-wrap', paddingRight: '8px'
                }}>
                  {change.newLine || '(empty)'}
                </code>
              </div>
            )}
          </div>
        </div>

        {/* Footer Meta Bar */}
        <div style={{
          padding: '7px 12px 9px',
          borderTop: '1px dotted #2E2E2E',
          background: 'rgba(255, 255, 255, 0.01)',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.52rem',
          color: '#737373',
          letterSpacing: '0.06em',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>AUDIT  ·  {isModified ? `MODIFIED BY ${change.username.toUpperCase()}` : isAdded ? `INSERTED BY ${change.username.toUpperCase()}` : `DELETED BY ${change.username.toUpperCase()}`} AT {timeStr}</span>
        </div>
      </div>
    );
  };

  return (
    <div
      className="monaco-wrapper"
      ref={wrapperRef}
      style={{ height: '100%', position: 'relative' }}
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

      {/* View-only access indicator. (Per-file "who's here" presence lives in
          the File Explorer, so it's not duplicated here.) */}
      {!isReplaying && sessionId && !canEdit && (
        <div title="The session owner has set you to view-only" style={{
          position: 'absolute',
          top: '8px',
          right: '14px',
          zIndex: 30,
          pointerEvents: 'none',
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          padding: '3px 9px',
          background: 'rgba(255,176,36,0.12)',
          border: '1px solid rgba(255,176,36,0.4)',
          borderRadius: '999px',
          fontFamily: 'var(--font-number)', fontSize: '0.55rem', fontWeight: 700,
          letterSpacing: '0.1em', color: '#FFB224',
        }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#FFB224"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          VIEW ONLY
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
          readOnly: isReplaying || !canEdit,
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
        .margin-view-overlays > div:has(.has-line-edit) .line-numbers {
          color: #FFB224 !important;
          font-weight: 700;
          cursor: pointer !important;
          transition: color 0.15s ease;
        }
        .margin-view-overlays > div:has(.has-line-edit):hover .line-numbers {
          color: transparent !important;
          position: relative;
        }
        .margin-view-overlays > div:has(.has-line-edit):hover .line-numbers::after {
          content: '⚡';
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FFB224;
          font-size: 13px;
          font-weight: bold;
          pointer-events: none;
          animation: lightning-pop 0.15s ease-out;
        }
        @keyframes lightning-pop {
          from { transform: scale(0.6); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
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
