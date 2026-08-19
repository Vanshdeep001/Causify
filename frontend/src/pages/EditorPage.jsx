/* -------------------------------------------------------
 * EditorPage.jsx — Main Application Workspace
 * ------------------------------------------------------- */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import MonacoEditor from '../components/Editor/MonacoEditor';
import TerminalPanel from '../components/Terminal/TerminalPanel';
import useEditorStore from '../store/useEditorStore';
import { saveFile } from '../services/api';
import { sendCodeChange } from '../services/socket';
import { saveFileAs, saveFileToHandle } from '../services/fileSave';

import FileExplorer from '../components/Editor/FileExplorer';
import BinaryFilePreview from '../components/Editor/BinaryFilePreview';
import EmptyEditorState from '../components/Editor/EmptyEditorState';
import { isBinaryAssetPath, isTextImagePath } from '../utils/binaryAssets';
import ImpactWarningBanner from '../components/Editor/ImpactWarningBanner';
import ConnectionBanner from '../components/Session/ConnectionBanner';
import AdmissionRequests from '../components/Session/AdmissionRequests';
import Whiteboard from '../components/Editor/Whiteboard';
import ScreenCapture from '../components/Capture/ScreenCapture';
import MarioCompanion from '../components/Mario/MarioCompanion';
import { PixelSprite, MARIO_PAL, MARIO_ROWS } from '../components/common/pixelArt';
import { initials } from '../utils/initials';

/* ── Language Icon Component ── */
const LanguageIcon = ({ filename, size = 20 }) => {
  const currentLanguage = useEditorStore((s) => s.language);
  if (!filename) return null;
  
  let ext = filename.split('.').pop()?.toLowerCase();
  
  const knownExtensions = new Set([
    'java', 'py', 'pyw', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp',
    'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'json', 'md', 'mdx',
    'txt', 'text'
  ]);
  
  if (!knownExtensions.has(ext)) {
    if (currentLanguage === 'javascript') ext = 'js';
    else if (currentLanguage === 'typescript') ext = 'ts';
    else if (currentLanguage === 'python') ext = 'py';
    else ext = currentLanguage;
  }

  const baseStyle = {
    width: size, height: size, display: 'flex', alignItems: 'center',
    justifyContent: 'center', borderRadius: '0', fontWeight: 900,
    fontSize: size * 0.52, fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    letterSpacing: '-0.02em', flexShrink: 0, lineHeight: 1,
    background: 'transparent', boxShadow: 'none'
  };

  switch (ext) {
    case 'java':
      return (
        <div style={baseStyle}>
          <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24" fill="#f89820">
            <path d="M8.851 18.56s-.917.534.653.714c1.902.218 2.874.187 4.969-.211 0 0 .552.346 1.321.646-4.699 2.013-10.633-.118-6.943-1.149M8.276 15.933s-1.028.762.542.924c2.032.209 3.636.227 6.413-.308 0 0 .384.389.987.602-5.679 1.661-12.007.13-7.942-1.218M13.116 11.475c1.158 1.333-.304 2.533-.304 2.533s2.939-1.518 1.589-3.418c-1.261-1.772-2.228-2.652 3.007-5.688 0 0-8.216 2.051-4.292 6.573M19.33 20.504s.679.559-.747.991c-2.712.822-11.288 1.069-13.669.033-.856-.373.75-.89 1.254-.998.527-.114.828-.093.828-.093-.953-.671-6.156 1.317-2.643 1.887 9.58 1.553 17.462-.7 14.977-1.82M9.292 13.21s-4.362 1.036-1.544 1.412c1.189.159 3.561.123 5.77-.062 1.806-.152 3.618-.477 3.618-.477s-.637.272-1.098.587c-4.429 1.165-12.986.623-10.522-.568 2.082-1.006 3.776-.892 3.776-.892M17.116 17.584c4.503-2.34 2.421-4.589.968-4.285-.356.075-.515.14-.515.14s.132-.207.385-.297c2.875-1.011 5.086 2.981-.929 4.56 0 0 .07-.062.091-.118" />
            <path d="M14.401 .734s2.494 2.494-2.365 6.338c-3.896 3.079-.889 4.836 0 6.838-2.274-2.053-3.943-3.858-2.824-5.541 1.644-2.469 6.197-3.665 5.189-7.635" fill="#f89820" />
          </svg>
        </div>
      );
    case 'py':
    case 'pyw':
      return (
        <div style={baseStyle}>
          <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24">
            <path d="M11.914 0C5.82 0 6.2 2.656 6.2 2.656l.007 2.752h5.814v.826H3.9S0 5.789 0 11.969c0 6.18 3.403 5.96 3.403 5.96h2.03v-2.867s-.109-3.42 3.35-3.42h5.766s3.24.052 3.24-3.148V3.202S18.28 0 11.914 0zM8.708 1.85c.578 0 1.046.47 1.046 1.05s-.468 1.05-1.046 1.05c-.579 0-1.046-.47-1.046-1.05s.467-1.05 1.046-1.05z" fill="#3776AB" />
            <path d="M12.086 24c6.094 0 5.714-2.656 5.714-2.656l-.007-2.752h-5.814v-.826H20.1s3.9.445 3.9-5.735c0-6.18-3.403-5.96-3.403-5.96h-2.03v2.867s.109 3.42-3.35 3.42H9.451s-3.24-.052-3.24 3.148v5.292S5.72 24 12.086 24zm3.206-1.85c-.578 0-1.046-.47-1.046-1.05s.468-1.05 1.046-1.05c.579 0 1.046.47 1.046 1.05s-.467 1.05-1.046 1.05z" fillOpacity="0.7" fill="#FFD43B"/>
          </svg>
        </div>
      );
    case 'c':
    case 'h':
      return (
        <div style={baseStyle}>
          <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 7.5H9.5V16.5H15" stroke="#659AD2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      );
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return (
        <div style={baseStyle}>
          <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11 7.5H7.5V16.5H11" stroke="#659AD2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 10V14M13 12H17" stroke="#659AD2" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M19 10V14M17 12H21" stroke="#659AD2" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      );
    case 'html':
    case 'htm':
      return (
        <div style={baseStyle}>
          <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24" fill="#f06529">
            <path d="M1.5 0h21l-1.91 21.563L11.977 24l-8.565-2.438L1.5 0zm7.031 9.75l-.232-2.718 10.059.003.076-.757.076-.771.076-.758H6.862l.618 6.968h7.769l-.352 3.524-2.921.789-2.886-.789-.198-2.209H6.921l.383 4.29L12 19.016l4.695-1.258.666-7.508H8.531z" />
          </svg>
        </div>
      );
    case 'css':
      return (
        <div style={baseStyle}>
          <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24" fill="#2965f1">
            <path d="M1.5 0h21l-1.91 21.563L11.977 24l-8.565-2.438L1.5 0zm17.09 4.413L5.41 4.41l.213 2.622 10.125.002-.255 2.716h-6.64l.24 2.573h6.182l-.366 3.523-2.91.804-2.956-.81-.188-2.11h-2.61l.29 3.855L12 19.002l5.355-1.12.83-9.617-8.945-.001.097-.36z" />
          </svg>
        </div>
      );
    case 'js':
      return (
        <div style={{ ...baseStyle, color: '#f7df1e' }}>
          JS
        </div>
      );
    case 'jsx':
      return (
        <div style={baseStyle}>
          <svg width={size * 0.85} height={size * 0.85} viewBox="0 0 24 24" fill="#61dafb">
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
        <div style={{ ...baseStyle, color: '#3178c6' }}>
          TS
        </div>
      );
    case 'tsx':
      return (
        <div style={{ ...baseStyle, color: '#61dafb' }}>
          TSX
        </div>
      );
    case 'json':
      return (
        <div style={{ ...baseStyle, color: '#fbc02d' }}>
          {`{ }`}
        </div>
      );
    case 'md':
    case 'mdx':
      return (
        <div style={{ ...baseStyle, color: 'var(--t2)' }}>
          MD
        </div>
      );
    case 'txt':
    case 'text':
    case 'plaintext':
      return (
        <div style={{ ...baseStyle, color: 'var(--t3)' }}>
          TXT
        </div>
      );
    default:
      return (
        <div style={baseStyle}>
          <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth="2">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
        </div>
      );
  }
};


/* ── CodeShot Toolbar Button ── */
const CodeShotButton = () => {
  const editorSelection = useEditorStore((s) => s.editorSelection);
  const openCodeShotModal = useEditorStore((s) => s.openCodeShotModal);
  const activePath = useEditorStore((s) => s.activePath);
  const language = useEditorStore((s) => s.language);
  const gitRepoConnected = useEditorStore((s) => s.gitRepoConnected);
  const gitStatus = useEditorStore((s) => s.gitStatus);

  const [hint, setHint] = useState(null); // null | 'select'
  const [hovered, setHovered] = useState(false);

  const hasSelection = editorSelection && editorSelection.code && editorSelection.code.length > 0;

  const handleClick = () => {
    if (!hasSelection) {
      setHint('select');
      setTimeout(() => setHint(null), 2500);
      return;
    }

    const now = new Date();
    let branch = '—';
    if (gitRepoConnected && gitStatus) {
      const match = gitStatus.match?.(/On branch (\S+)/);
      if (match) branch = match[1];
    }

    openCodeShotModal({
      code: editorSelection.code,
      language: language || 'plaintext',
      filePath: activePath || 'untitled',
      startLine: editorSelection.startLine,
      endLine: editorSelection.endLine,
      branch,
      timestamp: now.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }),
    });
  };

  const bg = hasSelection
    ? hovered
      ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.04) 100%)'
      : 'linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.01) 100%)'
    : hovered
      ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%)'
      : 'transparent';

  const border = hasSelection
    ? hovered
      ? '1px solid rgba(255, 255, 255, 0.80)'
      : '1px solid rgba(255, 255, 255, 0.30)'
    : hovered
      ? '1px solid var(--line-strong)'
      : '1px solid var(--line)';

  const color = hasSelection
    ? '#FFFFFF'
    : hovered
      ? 'var(--t1)'
      : 'var(--t3)';

  const shadow = hasSelection && hovered
    ? '0 0 10px rgba(255, 255, 255, 0.15)'
    : hovered
      ? '0 0 6px rgba(255, 255, 255, 0.04)'
      : 'none';

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={hasSelection
          ? `Capture CodeShot (${editorSelection.endLine - editorSelection.startLine + 1} lines) — Ctrl+Shift+K`
          : 'Select code first, then capture a CodeShot — Ctrl+Shift+K'
        }
        style={{
          width: '28px',
          height: '28px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          color: color,
          padding: 0,
          position: 'relative',
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: hovered ? 'scale(1.1) rotate(-5deg)' : 'scale(1) rotate(0deg)',
            transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            filter: hasSelection && hovered ? 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.4))' : 'none',
          }}
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>

      </button>

      {hint === 'select' && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginTop: '8px',
          padding: '6px 12px',
          background: '#1A1A1A',
          border: '1px solid #2E2E2E',
          borderRadius: '6px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10px',
          color: '#A0A0A0',
          whiteSpace: 'nowrap',
          zIndex: 100,
          pointerEvents: 'none',
          animation: 'fadeIn 0.15s ease-out',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <span style={{ color: '#C7FF5E', fontWeight: 700 }}>Select code</span> in the editor first
          <div style={{
            position: 'absolute',
            top: '-4px',
            left: '50%',
            transform: 'translateX(-50%) rotate(45deg)',
            width: '8px', height: '8px',
            background: '#1A1A1A',
            borderTop: '1px solid #2E2E2E',
            borderLeft: '1px solid #2E2E2E',
          }} />
        </div>
      )}
    </div>
  );
};


/* Sidebar resize limits. Module scope on purpose: resize() is a useCallback
 * with no dependencies, so anything it reads must not be re-created per render.
 * The floor is what the explorer's own header needs to stay intact. */
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 800;

const EditorPage = () => {
  const isTerminalOpen = useEditorStore((s) => s.isTerminalOpen);
  const terminalHeight = useEditorStore((s) => s.terminalHeight);
  const isRunning = useEditorStore((s) => s.isRunning);
  const isReplaying = useEditorStore((s) => s.isReplaying);
  const error = useEditorStore((s) => s.error);
  const snapshots = useEditorStore((s) => s.snapshots);
  const currentSnapshotIndex = useEditorStore((s) => s.currentSnapshotIndex);
  const sessionId = useEditorStore((s) => s.sessionId);
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const openFileCount = useEditorStore((s) => Object.keys(s.files || {}).length);
  // Anything that needs something to work on — rather than specifically a
  // session — keys off this. An opened folder counts, and so does an untitled
  // file: having a buffer open is reason enough for the whiteboard to exist.
  const hasWorkspace = Boolean(sessionId || workspaceRoot || openFileCount > 0);
  const sessionName = useEditorStore((s) => s.sessionName);
  const isFileExplorerOpen = useEditorStore((s) => s.isFileExplorerOpen);
  const fileActivity = useEditorStore((s) => s.fileActivity);
  const currentUser = useEditorStore((s) => s.currentUser);
  const userRole = useEditorStore((s) => s.userRole);

  const runCode = useEditorStore((s) => s.runCode);
  const marioOpen = useEditorStore((s) => s.marioOpen);
  const toggleMario = useEditorStore((s) => s.toggleMario);
  const goToLive = useEditorStore((s) => s.goToLive);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const setFileExplorerOpen = useEditorStore((s) => s.setFileExplorerOpen);
  const activePath = useEditorStore((s) => s.activePath);

  // Whether an SVG is showing its markup rather than the picture. Declared here,
  // after activePath, because the effect below reads it — a const referenced
  // above its declaration is in the temporal dead zone and throws during render.
  const [showSvgSource, setShowSvgSource] = useState(false);
  useEffect(() => { setShowSvgSource(false); }, [activePath]);

  const collisionWarning = useEditorStore((s) => s.collisionWarning);
  const code = useEditorStore((s) => s.code);
  const connectedUsers = useEditorStore((s) => s.connectedUsers);

  /* Who is in THIS file with you — not who is in the session.
   *
   * The distinction is the entire point of the thread. "Four people are
   * connected" is ambient and answers nothing; "Ana has the file you are
   * looking at open" is the one fact that changes what you do next, because it
   * is the only situation where two people can quietly build the same thing.
   * The file tree already carries session-wide presence, file by file.
   *
   * Keyed off filePresence, which peers announce on every file switch. */
  const filePresence = useEditorStore((s) => s.filePresence);
  const remoteTyping = useEditorStore((s) => s.remoteTyping);
  const peers = activePath
    ? Object.entries(filePresence)
        .filter(([uid, p]) => p.path === activePath && uid !== currentUser?.id)
        .map(([uid, p]) => ({ id: uid, ...p, typing: Boolean(remoteTyping[uid]) }))
    : [];
  const activeView = useEditorStore((s) => s.activeView);
  const setActiveView = useEditorStore((s) => s.setActiveView);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [saveHovered, setSaveHovered] = useState(false);

  // Resizable Sidebar
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const isResizing = useRef(false);

  const startResizing = useCallback((e) => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const stopResizing = useCallback(() => {
    if (isResizing.current) {
      isResizing.current = false;
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    }
  }, []);

  const resize = useCallback((e) => {
    if (!isResizing.current) return;
    /* Clamped, not ignored. The old check simply skipped the update once the
     * pointer went out of range, which froze the panel at whatever width the
     * cursor happened to be crossing — drag fast and it stuck somewhere
     * arbitrary. Clamping pins it to the limit instead.
     *
     * The floor is 220 rather than 150 because the Project Files row alone
     * needs roughly that much: below it the action buttons were pushed off the
     * panel's edge and the headings broke apart mid-word. */
    setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX)));
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);



  const terminalLayoutMode = useEditorStore((s) => s.terminalLayoutMode);

  // Save state selectors
  const fileHandles = useEditorStore((s) => s.fileHandles);
  const savedContents = useEditorStore((s) => s.savedContents);
  const fileSavedPaths = useEditorStore((s) => s.fileSavedPaths);
  const markFileSaved = useEditorStore((s) => s.markFileSaved);
  const setFileHandle = useEditorStore((s) => s.setFileHandle);
  const setFileSavedPath = useEditorStore((s) => s.setFileSavedPath);

  // Dirty state for active file
  const isCurrentDirty = activePath
    ? (savedContents[activePath] !== undefined && code !== savedContents[activePath])
    : false;
  const hasDiskHandle = activePath ? !!fileHandles[activePath] : false;
  const diskName = activePath ? fileSavedPaths[activePath] : null;

  const hasError = Boolean(error && error.trim());
  const hasSnapshots = snapshots.length > 0;

  const openReplay = () => setTerminalActiveTab('timeline');

  /* ── Save current file (to disk via OS dialog + backend) ── */
  const handleSave = useCallback(async () => {
    if (!activePath || isSaving) return;
    setIsSaving(true);
    try {
      const currentCode = useEditorStore.getState().code;

      // Local mode: write straight back to the file on disk. No Save As dialog —
      // the file already has a home, and this is what makes the change visible
      // in other editors.
      if (useEditorStore.getState().workspaceRoot) {
        await useEditorStore.getState().writeLocalFile(activePath, currentCode);
        setSaveFlash(true);
        setTimeout(() => setSaveFlash(false), 1500);
        return;
      }

      // An untitled buffer on the desktop: the first save picks a location, and
      // every save after that writes there directly.
      if (window.electronAPI?.workspace) {
        const written = await useEditorStore.getState().saveScratchFile(activePath, currentCode);
        if (written) {
          setSaveFlash(true);
          setTimeout(() => setSaveFlash(false), 1500);
        }
        return;
      }

      const existingHandle = useEditorStore.getState().fileHandles[activePath];

      if (existingHandle) {
        // Silent re-save
        const ok = await saveFileToHandle(existingHandle, currentCode);
        if (ok) {
          markFileSaved(activePath, currentCode);
        } else {
          // Handle invalidated — open Save As
          const result = await saveFileAs(activePath.split('/').pop(), currentCode);
          if (result) {
            if (result.handle) setFileHandle(activePath, result.handle);
            markFileSaved(activePath, currentCode);
            setFileSavedPath(activePath, result.name);
          }
        }
      } else {
        // First save — open OS dialog
        const result = await saveFileAs(activePath.split('/').pop(), currentCode);
        if (result) {
          if (result.handle) setFileHandle(activePath, result.handle);
          markFileSaved(activePath, currentCode);
          setFileSavedPath(activePath, result.name);
        }
      }

      // Also persist to backend session
      if (sessionId) {
        await saveFile(sessionId, activePath, currentCode);
      }
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1500);
    } catch (err) {
      console.error('[Causify] Save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [activePath, isSaving, sessionId, markFileSaved, setFileHandle, setFileSavedPath]);

  /* ── Save As (always opens OS dialog) ── */
  const handleSaveAs = useCallback(async () => {
    if (!activePath || isSaving) return;
    setIsSaving(true);
    try {
      const currentCode = useEditorStore.getState().code;
      const result = await saveFileAs(activePath.split('/').pop(), currentCode);
      if (result) {
        if (result.handle) setFileHandle(activePath, result.handle);
        markFileSaved(activePath, currentCode);
        setFileSavedPath(activePath, result.name);
      }
      // Also persist to backend
      if (sessionId) {
        await saveFile(sessionId, activePath, currentCode);
      }
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1500);
    } catch (err) {
      console.error('[Causify] Save As failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [activePath, isSaving, sessionId, markFileSaved, setFileHandle, setFileSavedPath]);

  /* ── Pick up edits made outside Causify ──
   * In local mode the file on disk is the source of truth, so another editor (or
   * a git checkout) can change it underneath us. Watch the open file and pull
   * the new contents in — but never over unsaved edits, which would silently
   * discard the user's work. A dirty buffer keeps what's on screen.
   */
  useEffect(() => {
    if (!activePath) return;
    const store = useEditorStore.getState();
    if (!store.workspaceRoot || !window.electronAPI?.watchFile) return;

    const absolute = store.absolutePathFor(activePath);
    if (!absolute) return;

    const unsubscribe = window.electronAPI.watchFile(absolute, ({ content }) => {
      const state = useEditorStore.getState();
      if (state.activePath !== activePath) return;      // user moved on
      if (state.isFileDirty(activePath)) return;        // don't clobber unsaved work
      if (state.code === content) return;               // our own write echoing back

      state.updateRemoteFile(activePath, content, null);
      state.markFileSaved(activePath, content);
      console.log('[Causify] Reloaded from disk after an external change:', activePath);
    });

    return unsubscribe;
  }, [activePath]);

  /* ── Protect against closing with unsaved changes ── */
  useEffect(() => {
    const handler = (e) => {
      const dirty = useEditorStore.getState().getAnyDirtyFiles();
      if (dirty.length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  /* ── Shared toolbar button base styles ── */
  const H = '28px'; // uniform height for all toolbar controls

  const headerH = 48;

  const pathParts = activePath ? activePath.split('/') : [];
  const fileName = activePath ? pathParts.pop() : '';
  const directoryPath = activePath ? pathParts.join(' / ') : '';

  return (
    <div
      className="dashboard-layout"
      style={{
        minHeight: `calc(100vh - ${headerH}px)`,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div
        id="causify-editor-region"
        className="tile-main"
        style={{
          padding: 0,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >

        {/* ────── Toolbar ────── */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--s1)',
          zIndex: 20,
          flexShrink: 0
        }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Sidebar toggle */}
            <button
              onClick={() => setFileExplorerOpen(!isFileExplorerOpen)}
              title="Toggle file explorer"
              style={{
                width: '28px', height: '28px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent',
                color: isFileExplorerOpen ? 'var(--t1)' : 'var(--t3)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                padding: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = isFileExplorerOpen ? 'var(--t1)' : 'var(--t3)'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>

            {/* File info, Save, CodeShot first */}
            {activePath ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {/* File breadcrumb */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <LanguageIcon filename={fileName} size={15} />
                  <span style={{
                    fontFamily: 'var(--font-header)',
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    color: 'var(--t1)',
                    letterSpacing: '0.02em',
                  }}>
                    {fileName}
                  </span>
                </div>
                {/* Picture / markup toggle, for files that are legitimately
                    both. Only rendered for SVG — nothing else has two views. */}
                {isTextImagePath(activePath) && (
                  <button
                    onClick={() => setShowSvgSource((v) => !v)}
                    title={showSvgSource ? 'Show the image' : 'Show the markup'}
                    style={{
                      marginLeft: '4px',
                      padding: '2px 8px',
                      background: 'transparent',
                      border: '1px solid var(--line-strong)',
                      borderRadius: '3px',
                      color: 'var(--t3)',
                      fontFamily: 'var(--font-number)',
                      fontSize: '0.5rem',
                      fontWeight: 700,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--t1)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--t3)'; }}
                  >
                    {showSvgSource ? 'Preview' : 'Source'}
                  </button>
                )}

                {/* Disk path badge */}
                {diskName && (
                  <span title={`Saved to: ${diskName}`} style={{
                    fontSize: '0.56rem', color: 'var(--emerald)',
                    fontFamily: 'var(--font-number)', letterSpacing: '0.02em',
                    display: 'flex', alignItems: 'center', gap: '4px',
                  }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    {diskName}
                  </span>
                )}
                {/* Save */}
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    onMouseEnter={() => setSaveHovered(true)}
                    onMouseLeave={() => setSaveHovered(false)}
                    title={
                      isSaving
                        ? 'Saving...'
                        : saveFlash
                          ? 'Saved successfully ✓'
                          : isCurrentDirty
                            ? 'Unsaved changes (Ctrl+S)'
                            : hasDiskHandle
                              ? 'Save (Ctrl+S)'
                              : 'Save to disk (Ctrl+S)'
                    }
                    style={{
                      width: '28px',
                      height: '28px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 0,
                      cursor: isSaving ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                      color: saveFlash
                        ? 'var(--emerald)'
                        : isSaving
                          ? 'var(--t4)'
                          : isCurrentDirty
                            ? saveHovered
                              ? 'var(--t1)'
                              : 'var(--t2)'
                            : saveHovered
                              ? 'var(--t1)'
                              : 'var(--t3)',
                      boxShadow: 'none',
                      padding: 0,
                      position: 'relative',
                    }}
                  >
                    {isSaving ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        style={{
                          animation: 'spin 1s linear infinite',
                        }}
                      >
                        <path d="M12 2a10 10 0 1 0 10 10" strokeDasharray="32" strokeDashoffset="8" />
                      </svg>
                    ) : saveFlash ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          transform: 'scale(1.1)',
                          filter: 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.4))',
                          transition: 'all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                        }}
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          transform: saveHovered ? 'scale(1.1) rotate(5deg)' : 'scale(1) rotate(0deg)',
                          transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                          filter: isCurrentDirty && saveHovered ? 'drop-shadow(0 0 4px rgba(255, 255, 255, 0.4))' : 'none',
                        }}
                      >
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                      </svg>
                    )}
                  </button>
                </div>
                {/* CodeShot button */}
                <CodeShotButton />
              </div>
            ) : (
              /* Matches the filename that occupies this same slot — same face,
                 weight and size, only dimmer. The row then reads identically
                 whether a file is open or not, instead of the type changing
                 shape as soon as one is. */
              <span style={{
                fontFamily: 'var(--font-header)',
                fontWeight: 700,
                fontSize: '0.78rem',
                letterSpacing: '0.02em',
                color: 'var(--t3)',
              }}>No file open</span>
            )}

            {/* Separator line between file info and view switcher */}
            {hasWorkspace && (
              <div style={{ width: '1px', height: '14px', background: 'var(--line-strong)', margin: '0 4px' }} />
            )}

            {/* View Switcher: Editor / Whiteboard second.
                Available for an opened folder too — the whiteboard is a thinking
                tool, not a collaboration-only one, and its contents are kept
                locally when there is no session to sync them to. */}
            {hasWorkspace && (
              <div style={{
                display: 'flex',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--line)',
                borderRadius: '4px',
                padding: '2px',
                alignItems: 'center',
              }}>
                <button
                  onClick={() => setActiveView('code')}
                  title="Switch to Code Editor"
                  style={{
                    height: '20px',
                    padding: '0 8px',
                    border: 'none',
                    borderRadius: '3px',
                    fontSize: '0.56rem',
                    fontFamily: 'var(--font-header)',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    cursor: 'pointer',
                    background: activeView === 'code' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                    border: activeView === 'code' ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid transparent',
                    color: activeView === 'code' ? 'var(--t1)' : 'var(--t3)',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={e => { if (activeView !== 'code') e.currentTarget.style.color = 'var(--t1)'; }}
                  onMouseLeave={e => { if (activeView !== 'code') e.currentTarget.style.color = 'var(--t3)'; }}
                >
                  EDITOR
                </button>
                <button
                  onClick={() => setActiveView('whiteboard')}
                  title="Switch to Collaborative Whiteboard"
                  style={{
                    height: '20px',
                    padding: '0 8px',
                    border: 'none',
                    borderRadius: '3px',
                    fontSize: '0.56rem',
                    fontFamily: 'var(--font-header)',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    cursor: 'pointer',
                    background: activeView === 'whiteboard' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                    border: activeView === 'whiteboard' ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid transparent',
                    color: activeView === 'whiteboard' ? 'var(--t1)' : 'var(--t3)',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={e => { if (activeView !== 'whiteboard') e.currentTarget.style.color = 'var(--t1)'; }}
                  onMouseLeave={e => { if (activeView !== 'whiteboard') e.currentTarget.style.color = 'var(--t3)'; }}
                >
                  WHITEBOARD
                </button>
              </div>
            )}

            {sessionId && isReplaying && (
              <button
                onClick={goToLive}
                style={{
                  height: '22px',
                  padding: '0 10px',
                  fontFamily: 'var(--font-number)',
                  fontSize: '0.58rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: '#38BDF8',
                  background: 'rgba(0, 162, 255, 0.05)',
                  border: '1px solid rgba(0, 162, 255, 0.25)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#00A2FF';
                  e.currentTarget.style.color = '#0A0A0A';
                  e.currentTarget.style.borderColor = '#00A2FF';
                  e.currentTarget.style.boxShadow = '0 0 8px rgba(0, 162, 255, 0.4)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(0, 162, 255, 0.05)';
                  e.currentTarget.style.color = '#38BDF8';
                  e.currentTarget.style.borderColor = 'rgba(0, 162, 255, 0.25)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'scaleX(-1)' }}>
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                SNAPSHOT #{currentSnapshotIndex + 1} — BACK TO LIVE
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {sessionId && (
              /* Who is in the room, and only that. Copying the invitation lives
                 in the sidebar under the OWNER/COLLAB badge, where someone goes
                 when they are thinking about who else should be here — so the
                 header is presence, nothing else. */
              <div
                style={{
                  display: 'flex', alignItems: 'center', padding: '0 4px', height: '26px',
                  userSelect: 'none',
                  opacity: 0.85,
                }}
              >
                <span className="hdr-thread">
                  <span
                    className="hdr-av is-me"
                    style={{ borderColor: userRole === 'owner' ? 'var(--lime)' : 'var(--cyan)' }}
                    title={peers.length > 0
                      ? `You — ${userRole || 'collaborator'} — and ${peers.length} other${peers.length === 1 ? '' : 's'} in this file`
                      : `You — ${userRole || 'collaborator'} — nobody else is in this file`}
                  >
                    {initials(currentUser?.username || 'Me')}
                  </span>

                  {peers.length > 0 && <span className="hdr-line" />}

                  {peers.slice(0, 3).map((u, i) => (
                    <span
                      key={u.id}
                      className={`hdr-av ${u.typing ? 'is-typing' : ''}`}
                      style={{ background: u.color || '#6366f1', zIndex: 3 - i }}
                      title={`${u.username} — ${u.typing ? 'typing in this file now' : 'has this file open'}`}
                    >
                      {initials(u.username)}
                      {u.typing && <span className="hdr-ring" />}
                    </span>
                  ))}
                  {peers.length > 3 && (
                    <span className="hdr-av is-more">+{peers.length - 3}</span>
                  )}
                </span>
              </div>
            )}

            {/* Screen capture — screenshot & recording */}
            <ScreenCapture />

            {/* Invoke Mario. Beside RUN because it is the other half of the
                same loop: RUN tells you it broke, Mario fixes it. Available
                without a run having happened, which is the whole point — a
                crashed dev server never produces one. */}
            <button
              onClick={toggleMario}
              className={`mario-invoke${marioOpen ? ' is-on' : ''}`}
              title={marioOpen ? 'Send Mario away' : 'Invoke Mario — fix or change code'}
            >
              <span className="mario-invoke-sprite">
                <PixelSprite rows={MARIO_ROWS} palette={MARIO_PAL} px={1.5} />
              </span>
              MARIO
            </button>

            {/* Run — primary action */}
            <button
              onClick={runCode}
              disabled={isRunning}
              className="run-button"
            >
              {isRunning ? (
                <span className="loading-spinner" style={{ width: '10px', height: '10px' }} />
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 3 21 12 6 21" />
                </svg>
              )}
              {isRunning ? 'RUNNING...' : 'RUN'}
            </button>
          </div>
        </div>

        {/* ────── Main Content Area ────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {isFileExplorerOpen && (
            <div style={{ width: `${sidebarWidth}px`, flexShrink: 0, position: 'relative', display: 'flex' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <FileExplorer onToggle={() => setFileExplorerOpen(false)} />
              </div>
              {/* Resize Handle */}
              <div
                onMouseDown={startResizing}
                style={{
                  width: '4px',
                  cursor: 'col-resize',
                  background: 'transparent',
                  position: 'absolute',
                  right: '-2px',
                  top: 0,
                  bottom: 0,
                  zIndex: 10,
                  transition: 'background 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-electric-blue)'}
                onMouseLeave={e => { if (!isResizing.current) e.currentTarget.style.background = 'transparent'; }}
              />
            </div>
          )}

          <div style={{ flex: 1, position: 'relative', minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Outside the view switch below, not inside it. Somebody knocks
                most often right after the owner has shared the code — which is
                frequently before any file is open, and can be while they are on
                the whiteboard. Nested in the editor branch, the prompt would
                simply not exist at the moment it matters most. */}
            <AdmissionRequests />

            {/* The switcher is hidden without a project, so showing the board
                here would strand the user on it with no way back to the editor.
                activeView is persisted, so this also covers reopening the app
                after closing it while the whiteboard was up. */}
            {activeView === 'whiteboard' && hasWorkspace ? (
              <div style={{ flex: 1, position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <Whiteboard />
              </div>
            ) : activePath && (isBinaryAssetPath(activePath) || (isTextImagePath(activePath) && !showSvgSource)) ? (
              /* An SVG opens as a picture, because that is what you usually want
                 to check. "Edit source" switches to the markup. */
              <BinaryFilePreview onEditSource={() => setShowSvgSource(true)} />
            ) : activePath ? (
              <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {/* Line-collision lock removed — the CRDT merges concurrent edits,
                    so same-line editing is safe and no longer blocked. */}
                {/* Above the impact warning: if the session is gone, that is
                    the more urgent thing on screen. */}
                <ConnectionBanner />
                <ImpactWarningBanner />
                {/* Presence used to float over this corner. It lives in the
                    header now, so the editor is left alone. */}
                <div id="causify-code-region" style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                  <MonacoEditor />
                </div>
              </div>
            ) : (
              <EmptyEditorState sidebarCollapsed={!isFileExplorerOpen} />
            )}
            <TerminalPanel />
          </div>
        </div>
      </div>

      {/* Last, and outside every pane. He is position:fixed and belongs to the
          window rather than to any layout, so mounting him at the end keeps him
          above the editor, the terminal and the sidebar alike — and clear of
          any ancestor that could trap a fixed child in its own box. */}
      <MarioCompanion />
    </div>
  );
};

export default EditorPage;
