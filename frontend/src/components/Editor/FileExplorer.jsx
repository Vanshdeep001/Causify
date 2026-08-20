/* -------------------------------------------------------
 * FileExplorer.jsx — Sidebar with Session + File Management
 * ------------------------------------------------------- */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import useEditorStore from '../../store/useEditorStore';
import { createSession, joinSession, knockSession, getAdmissionStatus, cancelKnock, leaveSession, uploadProject, saveFile, deleteFile, gitStatus } from '../../services/api';
import { connectWebSocket, sendCodeChange, sendFileDelete, sendProjectSync, sendFileLock } from '../../services/socket';
import { buildCollabCallbacks } from '../../services/collabCallbacks';
import { setOrigin, resetOrigin, buildJoinCode, parseJoinCode, getOrigin, setSessionToken, clearSessionToken } from '../../services/backendHost';
import { publishSession, resolveSession } from '../../services/rendezvous';
import { detectProject } from '../../services/devserver';
import { isBinaryAssetPath, isSkippedAssetPath } from '../../utils/binaryAssets';
import { decorationFor, parseGitStatus } from '../../utils/gitStatusMap';
import MarioLoader from '../common/MarioLoader';

/* A usable name for someone who has not typed one. The create form has always
   opened with a name already in it, and an empty one would reach the server as
   an anonymous author — so resetting the form regenerates rather than blanks. */
const freshUsername = () => 'User ' + Math.floor(Math.random() * 1000);

/* One step of nesting, in pixels. Rows indent themselves by this much per
   level and draw their guide lines on the same grid, so the two can never
   drift apart — which is the usual way a hand-tuned tree ends up with guides
   that miss the icons they belong to. */
const FX_INDENT = 15;

/* Both halves of joining fail the same ways — wrong code, wrong password, host
   unreachable — and the person reading the message cannot tell which request
   was in flight, so neither should the wording. */
const joinErrorMessage = (err) => {
  const msg = err.response?.data?.message || err.response?.data?.error;
  if (err.response?.status === 404) return 'SESSION NOT FOUND: This session ID does not exist or has expired.';
  if (err.response?.status === 401) return 'INVALID PASSWORD: Incorrect password for this session.';
  if (err.response?.status === 403) return 'NOT ADMITTED: The session owner has not let you in.';
  if (err.code === 'ERR_NETWORK' || !err.response) {
    return 'CANNOT REACH HOST: The session owner may be offline, or their share link has expired.';
  }
  return msg || err.message || 'Join failed';
};

/* Shown while a project is being read in. Defined at module scope: inside the
   component it would be a new type on every render, so React would rebuild it
   mid-upload — precisely when the parent re-renders most. */
const LoadingOverlay = () => (
  <div style={{
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    background: 'var(--s0)', zIndex: 1000,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '24px', textAlign: 'center'
  }}>
    {/* ── BOLD TYPOGRAPHY ── */}
    <div style={{
      fontFamily: 'var(--font-header)',
      fontSize: '0.85rem',
      fontWeight: 900,
      letterSpacing: '-0.02em',
      textTransform: 'uppercase',
      color: '#FFFFFF',
      lineHeight: 1
    }}>
      <span>Index</span>
      <span style={{ color: 'transparent', WebkitTextStroke: '1px rgba(255,255,255,0.7)', textStroke: '1px rgba(255,255,255,0.7)' }}>ing</span>
    </div>

    {/* ── PROGRESS BAR ── */}
    <div style={{
      width: '100%',
      maxWidth: '160px',
      marginTop: '20px',
      fontFamily: 'var(--font-number)',
      fontSize: '0.55rem',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--t3)', letterSpacing: '0.08em' }}>
        <span>PROGRESS</span>
        <span style={{ color: '#FFFFFF', fontWeight: 600 }}>74%</span>
      </div>
      <div style={{
        height: '4px',
        width: '100%',
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--line)',
        borderRadius: '2px',
        overflow: 'hidden',
        position: 'relative'
      }}>
        <div style={{
          height: '100%',
          width: '74%',
          background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.4), #FFFFFF)',
          boxShadow: '0 0 8px rgba(255, 255, 255, 0.6)',
          borderRadius: '2px'
        }} />
      </div>
    </div>
  </div>
);

const ActionButton = ({ onClick, title, children }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        border: 'none',
        color: hovered ? '#FFFFFF' : 'var(--t3)',
        cursor: 'pointer',
        padding: '6px 9px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.12s ease',
        flexShrink: 0
      }}
    >
      {children}
    </button>
  );
};

/**
 * The invitation an owner hands out.
 *
 * Sharing is one code and one password, the way it has always been — the host
 * address is folded into the code rather than added beside it, because a
 * second field is a second thing to explain and a second thing to get wrong.
 *
 * While the tunnel is opening the code still works for anyone on this machine
 * or this network, so it is shown immediately rather than held back behind a
 * spinner; the status line underneath says how far the reach currently
 * extends.
 */
const ShareStrip = ({ code, state, error, stale, onDismissStale }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      // Copying is the act of re-sharing, so the warning has served its purpose.
      if (stale && onDismissStale) onDismissStale();
    } catch {
      /* Clipboard blocked — the code is on screen and can be selected. */
    }
  };

  const status = {
    starting: { text: 'Opening internet access…', color: 'var(--t3)' },
    on: { text: 'Anyone with this code can join, from anywhere', color: 'var(--mint, #4ADE80)' },
    error: { text: error || 'Internet access unavailable — this network only', color: 'var(--amber, #FBBF24)' },
    off: { text: 'This network only', color: 'var(--t3)' },
  }[state] || { text: '', color: 'var(--t3)' };

  return (
    <div style={{
      margin: '8px 14px 4px',
      padding: '9px 10px',
      /* A changed link is a call to action, not a status line — it is tinted
         so it reads as something to do rather than something to know. */
      background: stale ? 'rgba(251,191,36,0.09)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${stale ? 'rgba(251,191,36,0.45)' : 'var(--line)'}`,
      borderRadius: '6px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    }}>
      <div style={{
        fontSize: '0.58rem',
        letterSpacing: '0.08em',
        color: stale ? 'var(--amber, #FBBF24)' : 'var(--t3)',
        fontWeight: 600,
      }}>
        {stale ? 'YOUR INVITE LINK CHANGED — SEND THIS' : 'SHARE THIS CODE'}
      </div>

      {stale && (
        <div style={{
          fontSize: '0.62rem',
          lineHeight: 1.5,
          color: 'var(--t2)',
        }}>
          The connection reset and Cloudflare issued a new address. Anyone
          already in the session has been disconnected — send them this.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <code style={{
          flex: 1,
          minWidth: 0,
          fontSize: '0.68rem',
          fontFamily: 'var(--font-mono, monospace)',
          color: 'var(--t1, #FFF)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }} title={code}>
          {code}
        </code>
        <button
          onClick={copy}
          title="Copy the join code"
          style={{
            background: copied ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.06)',
            border: '1px solid var(--line)',
            borderRadius: '4px',
            color: copied ? 'var(--mint, #4ADE80)' : 'var(--t2, #CCC)',
            cursor: 'pointer',
            fontSize: '0.6rem',
            padding: '4px 8px',
            flexShrink: 0,
            transition: 'all 0.12s ease',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div style={{ fontSize: '0.58rem', color: status.color, lineHeight: 1.4 }}>
        {state === 'starting' && <span style={{ marginRight: '4px' }}>◌</span>}
        {status.text}
      </div>
    </div>
  );
};

const FileExplorer = ({ onToggle }) => {
  const files = useEditorStore((s) => s.files);
  const activePath = useEditorStore((s) => s.activePath);
  const openFile = useEditorStore((s) => s.openFile);
  const sessionId = useEditorStore((s) => s.sessionId);
  const sessionName = useEditorStore((s) => s.sessionName);
  const joinCode = useEditorStore((s) => s.joinCode);
  const joinCodeStale = useEditorStore((s) => s.joinCodeStale);
  const tunnelState = useEditorStore((s) => s.tunnelState);
  const tunnelError = useEditorStore((s) => s.tunnelError);
  const currentUser = useEditorStore((s) => s.currentUser);
  const userRole = useEditorStore((s) => s.userRole);
  const connectedUsers = useEditorStore((s) => s.connectedUsers);

  // Owner and editor collaborators may create/upload/delete; viewers may not.
  const canEdit = userRole === 'owner'
    || connectedUsers.find((u) => u.id === currentUser?.id)?.permission !== 'viewer';

  /* Files the owner has frozen. Everyone sees which ones they are — a lock
     nobody can see just looks like the editor being broken. */
  const lockedFiles = useEditorStore((s) => s.lockedFiles);
  const isOwner = userRole === 'owner';

  const toggleFileLock = (path) => {
    if (!sessionId || !isOwner) return;
    sendFileLock(sessionId, path, !lockedFiles[path], currentUser);
  };

  const setSession = useEditorStore((s) => s.setSession);
  const setCurrentUser = useEditorStore((s) => s.setCurrentUser);
  const setUserRole = useEditorStore((s) => s.setUserRole);
  const setProject = useEditorStore((s) => s.setProject);
  const fileActivity = useEditorStore((s) => s.fileActivity);
  const filePresence = useEditorStore((s) => s.filePresence);
  const resetSession = useEditorStore((s) => s.resetSession);
  const addFile = useEditorStore((s) => s.addFile);
  const removeFile = useEditorStore((s) => s.removeFile);
  const impactWarnings = useEditorStore((s) => s.impactWarnings);
  const setDetectedProjects = useEditorStore((s) => s.setDetectedProjects);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const setTerminalOpen = useEditorStore((s) => s.setTerminalOpen);
  const setProjectRootPath = useEditorStore((s) => s.setProjectRootPath);

  // Local workspace — set when a folder was opened from disk rather than uploaded.
  const workspaceRoot = useEditorStore((s) => s.workspaceRoot);
  const workspaceName = useEditorStore((s) => s.workspaceName);
  const openLocalWorkspace = useEditorStore((s) => s.openLocalWorkspace);
  const closeLocalWorkspace = useEditorStore((s) => s.closeLocalWorkspace);
  const absolutePathFor = useEditorStore((s) => s.absolutePathFor);
  const canOpenLocalFolder = typeof window !== 'undefined' && Boolean(window.electronAPI?.workspace);

  /* ── Git decorations in the tree ──
   * Polled here rather than read from the git panel, because the panel is
   * usually closed and the decorations still have to be right. Parsed once per
   * fetch and shared by every row.
   */
  const gitStatusText = useEditorStore((s) => s.gitStatus);
  const gitRepoConnected = useEditorStore((s) => s.gitRepoConnected);
  const setGitStatus = useEditorStore((s) => s.setGitStatus);
  const gitScope = workspaceRoot || sessionId;

  const gitFileStatus = React.useMemo(() => parseGitStatus(gitStatusText), [gitStatusText]);

  useEffect(() => {
    if (!gitScope || !gitRepoConnected) return;

    let cancelled = false;
    const pull = async () => {
      try {
        const res = await gitStatus(gitScope);
        if (!cancelled && res?.success !== false) setGitStatus(res.output || '');
      } catch { /* the panel surfaces git errors; decorations just go quiet */ }
    };

    pull();
    // Slow on purpose: this is ambient information, and the working tree is
    // re-read from disk on every poll.
    const interval = setInterval(pull, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [gitScope, gitRepoConnected, setGitStatus]);

  const pendingExplorerAction = useEditorStore((s) => s.pendingExplorerAction);
  const clearPendingExplorerAction = useEditorStore((s) => s.clearPendingExplorerAction);

  // Welcome-screen requests (the Mario block's power-ups) land here:
  // run the matching explorer flow once, then clear. Deferred via a
  // cancellable timeout so StrictMode's throwaway first mount can't
  // consume the action — only the surviving mount executes it.
  useEffect(() => {
    if (!pendingExplorerAction) return;
    const timer = setTimeout(() => {
      if (pendingExplorerAction === 'import-project') {
        openProjectFolder();
      } else if (pendingExplorerAction === 'new-file') {
        startNewFile();
      }
      clearPendingExplorerAction();
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingExplorerAction, clearPendingExplorerAction]);

  // Compute set of file paths that are affected by active impacts
  const affectedPaths = new Set();
  impactWarnings.forEach(w => {
    if (w.affectedFiles) w.affectedFiles.forEach(f => affectedPaths.add(f));
    if (w.impacts) w.impacts.forEach(i => { if (i.file) affectedPaths.add(i.file); });
  });

  const inlineActionBtnSty = { background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', opacity: 0.7, transition: 'opacity 0.2s, color 0.2s' };

  // UI state
  const [panel, setPanel] = useState(null); // null | 'create' | 'join'
  const [projName, setProjName] = useState('My Project');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState(freshUsername);
  const [joinId, setJoinId] = useState('');
  const [joinPwd, setJoinPwd] = useState('');
  const [joinUsername, setJoinUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, rawSetErrorMsg] = useState('');
  const errorTimerRef = useRef(null);

  const setErrorMsg = useCallback((msg, duration = 5000) => {
    rawSetErrorMsg(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (msg) {
      errorTimerRef.current = setTimeout(() => {
        rawSetErrorMsg('');
      }, duration);
    }
  }, []);
  const [newItem, setNewItem] = useState(null); // { type: 'file'|'folder', parent: '', name: '' }
  const [hoveredIndex, setHoveredIndex] = useState(null);
  /* Standing at the door: { sessionId, requestId, since }. Null when not
     waiting, which is also what the join panel keys its two faces off. */
  const [waiting, setWaiting] = useState(null);
  // True from the instant an admission is spent until the join settles.
  const admittingRef = useRef(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const copyTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  /* The invitation, available for as long as the session is. The share strip
   * above the tree retires once someone arrives, and the header shows faces
   * rather than the code now — without this, a host who wanted to invite a
   * fourth person had nowhere left to get it. */
  const copyJoinCode = () => {
    const code = joinCode || sessionId;
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCodeCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCodeCopied(false), 2000);
  };

  /* Ask the server whether the owner has answered yet.
   *
   * Polled rather than pushed. The obvious alternative — open the session's
   * socket and listen — would put someone who has not been admitted inside the
   * topics carrying the code, which is the thing the door is for. */
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;

    const check = async () => {
      /* Downloading the project can easily outlast the two-second tick, and the
         admission is spent the moment the join lands. Without this the next
         poll reads its own success as "expired" and tears down a join that is
         going perfectly well. */
      if (admittingRef.current) return;

      try {
        const { status } = await getAdmissionStatus(waiting.sessionId, waiting.requestId);
        if (cancelled || admittingRef.current) return;
        if (status === 'admitted') {
          admittingRef.current = true;
          completeJoin(waiting.sessionId, waiting.requestId);
        } else if (status === 'denied') {
          setWaiting(null);
          resetOrigin();
          setErrorMsg('NOT ADMITTED: The session owner declined your request.');
        } else if (status === 'expired') {
          setWaiting(null);
          resetOrigin();
          setErrorMsg('REQUEST EXPIRED: Nobody answered. Ask the owner and try again.');
        }
      } catch {
        /* One failed poll is not an answer — the host may be mid-reconnect.
           Keep waiting; the interval will ask again. */
      }
    };

    check();
    const timer = setInterval(check, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [waiting]);

  /* The sidebar never unmounts, so this form outlives the session it started.
   * Leave a session, open "create" again, and you were looking at the last
   * run's name, project and password — someone else's, if the machine is
   * shared. Opening a panel is a fresh start, exactly as it looks on a cold
   * page load. */
  useEffect(() => {
    if (panel === 'create') {
      setUsername(freshUsername());
      setProjName('My Project');
      setPassword('');
    } else if (panel === 'join') {
      setJoinUsername('');
      setJoinId('');
      setJoinPwd('');
      // Reopening the panel is a fresh attempt, not a return to an old queue.
      setWaiting(null);
    }
    if (panel) setErrorMsg('');
  }, [panel, setErrorMsg]);


  useEffect(() => {
    const handleExplorerShortcuts = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.altKey && !sessionId) {
        const key = e.key.toLowerCase();
        if (key === 'n') {
          e.preventDefault();
          setPanel('create');
        } else if (key === 'j') {
          e.preventDefault();
          setPanel('join');
        } else if (key === 'i') {
          e.preventDefault();
          openProjectFolder();
        } else if (key === 'f') {
          e.preventDefault();
          startNewFile();
        }
      }
    };
    window.addEventListener('keydown', handleExplorerShortcuts);
    return () => window.removeEventListener('keydown', handleExplorerShortcuts);
  }, [sessionId]);

  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);


  const initSocket = (sessId, user) => {
    connectWebSocket(sessId, user, buildCollabCallbacks({
      sessionId: sessId,
      onConnected: () => {
        console.log('[Causify] Connected to Collab');
        useEditorStore.getState().loadSessionHistory(sessId);
      },
    }));
  };

  /**
   * Publish this machine's backend so invited people can reach the session
   * from anywhere, and fold the resulting address into the code the owner
   * shares.
   *
   * Deliberately not awaited by handleCreate. Opening a tunnel takes several
   * seconds, and blocking session creation on it would make starting a session
   * feel slower for the common case where everyone is already on this machine
   * or this network. The session is usable immediately with its plain id; the
   * code upgrades itself the moment the tunnel answers.
   */
  const beginSharing = (sessionIdValue) => {
    const store = useEditorStore.getState();
    store.setJoinCode(sessionIdValue);

    if (!window.electronAPI?.tunnel) {
      store.setTunnel('off');
      return;
    }

    store.setTunnel('starting');
    window.electronAPI.tunnel.start(8080)
      .then((res) => {
        // The session may already have been left while we were waiting.
        if (useEditorStore.getState().sessionId !== sessionIdValue) return;
        if (res?.ok && res.url) {
          useEditorStore.getState().setJoinCode(buildJoinCode(sessionIdValue, res.url));
          useEditorStore.getState().setTunnel('on');
          // File this address under the session id, so a joiner who was sent an
          // older code still lands here. Not awaited: the session is already
          // shareable, and the phone book being slow or down must not hold that
          // up — it only ever adds a way to find us.
          publishSession(sessionIdValue, res.url);
        } else {
          useEditorStore.getState().setTunnel('error', res?.error || 'Tunnel failed to start');
        }
      })
      .catch((err) => {
        if (useEditorStore.getState().sessionId !== sessionIdValue) return;
        useEditorStore.getState().setTunnel('error', err.message);
      });
  };

  const handleCreate = async (uploadedFiles = []) => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      // Hosting always means hosting here. A previous session joined on
      // someone else's machine would otherwise leave the origin pointed at
      // them, and this session would be created on their backend.
      resetOrigin();

      // Starting a session from an open folder means "share what I'm working
      // on": read the project off disk so peers receive the real contents. The
      // folder stays the source of truth — the session is only the transport.
      let filesToShare = uploadedFiles;
      if (filesToShare.length === 0 && workspaceRoot && window.electronAPI?.workspace?.readAll) {
        try {
          const contents = await window.electronAPI.workspace.readAll(workspaceRoot);
          filesToShare = Object.entries(contents).map(([path, content]) => ({ path, content }));
        } catch (err) {
          console.warn('[Causify] Could not read the folder to share it:', err.message);
        }
      }

      const session = await createSession(projName, username, password || '0000');
      // Remembered so a restored workspace can re-create its session
      // under the same identity after the window is closed and reopened.
      try { localStorage.setItem('causify-last-username', username); } catch { /* best effort */ }
      if (filesToShare.length > 0) {
        await uploadProject(session.id, filesToShare);
      }
      // Before setSession, so any guarded call made as the session comes up
      // already carries proof of membership.
      setSessionToken(session.token);
      setSession(session.id, session.name);
      setCurrentUser(session.user);
      setUserRole('owner');
      beginSharing(session.id);
      // Keep a local workspace as it is: the files are already on disk and the
      // tree is already correct. Replacing it would drop the disk connection.
      if (!workspaceRoot) setProject(filesToShare);
      initSocket(session.id, session.user);
      setPanel(null);
      return session.id;
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error;
      setErrorMsg(msg || err.message || 'Creation failed');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  /* Step one of two: ask.
   *
   * Knowing the code and password no longer puts anyone in the session — it
   * puts them in the queue. Nothing about the project comes back from this
   * call, so a wait that is never answered leaks nothing. */
  const handleJoin = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      // Where the host actually is, settled before the first request goes out.
      //
      // Two answers are available and they are tried in this order:
      //
      //   1. the rendezvous, asked for this session id — always current, because
      //      the host republishes every time its tunnel changes address;
      //   2. the address baked into the code, if it carries one.
      //
      // The lookup goes first precisely because the baked-in address is the one
      // that rots: a code from yesterday's chat names a tunnel that no longer
      // exists, and that is the whole reason for asking. When the phone book is
      // unreachable, has nothing filed, or was never configured, this falls
      // straight through to the baked-in address — and a plain id with neither
      // leaves the origin alone, which is what keeps same-machine and browser
      // sessions working exactly as they always did.
      const { sessionId: parsedId, origin: parsedOrigin } = parseJoinCode(joinId);
      const { url: publishedOrigin } = await resolveSession(parsedId);

      if (publishedOrigin) setOrigin(publishedOrigin);
      else if (parsedOrigin) setOrigin(parsedOrigin);
      else resetOrigin();

      const knock = await knockSession(parsedId, joinPwd, joinUsername);
      admittingRef.current = false;
      setWaiting({ sessionId: parsedId, requestId: knock.requestId, since: Date.now() });
    } catch (err) {
      resetOrigin();
      setErrorMsg(joinErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  /* Step two: the owner said yes.
   *
   * Everything below here is the join as it always was — this is the first
   * moment the server will part with a token or a file. */
  const completeJoin = async (parsedId, requestId) => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const session = await joinSession(parsedId, joinPwd, joinUsername, requestId);
      try { localStorage.setItem('causify-last-username', joinUsername); } catch { /* best effort */ }

      // On the desktop, put the shared project on the joiner's own disk and work
      // from there. Both sides then edit real files, and the session is only the
      // channel between them — which is what lets it be deleted afterwards.
      let landedOnDisk = false;
      const incoming = session.files || [];
      if (canOpenLocalFolder && incoming.length > 0) {
        try {
          const asMap = Object.fromEntries(incoming.map((f) => [f.path, f.content]));
          const placed = await window.electronAPI.workspace.materialize(asMap);
          if (placed) {
            openLocalWorkspace(placed);
            landedOnDisk = true;
          }
        } catch (err) {
          console.warn('[Causify] Could not write the shared project to disk:', err.message);
        }
      }

      // Before setSession, so any guarded call made as the session comes up
      // already carries proof of membership.
      setSessionToken(session.token);
      setSession(session.id, session.name);
      setCurrentUser(session.user);
      setUserRole('collaborator');
      // Keep the code that got us here, so a joiner can pass the invitation on
      // without the host having to re-send it.
      useEditorStore.getState().setJoinCode(buildJoinCode(session.id, getOrigin()));
      // If the files went to disk the tree already reflects them; loading the
      // in-memory copy over the top would sever the disk connection.
      if (!landedOnDisk) setProject(incoming);
      initSocket(session.id, session.user);
      setWaiting(null);
      setPanel(null);
    } catch (err) {
      // A failed join must not leave the app pointed at someone else's
      // machine, or every later request would go to a host we never reached.
      resetOrigin();
      setWaiting(null);
      setErrorMsg(joinErrorMessage(err));
    } finally {
      admittingRef.current = false;
      setIsLoading(false);
    }
  };

  // Per-file size caps. Images can be larger than source files but must still be
  // bounded so a session doesn't balloon the DB / websocket sync.
  const MAX_TEXT_SIZE = 1024 * 1024;        // 1 MB for source/text files
  const MAX_ASSET_SIZE = 5 * 1024 * 1024;   // 5 MB for images/fonts

  // Dependency, build-output and tooling directories that hold thousands of
  // files no one edits. Importing them bloats the session and slows the app.
  // 'site-packages' is the key one for Python: it catches every virtualenv's
  // packages no matter what the env folder is named (venv, .venv, env, …).
  const SKIP_DIRS = [
    // JS / Node
    'node_modules', 'bower_components', '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache',
    // Python virtual envs & caches
    'venv', '.venv', 'site-packages', '__pycache__',
    '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.eggs',
    // Version control / IDE / editor metadata
    '.git', '.hg', '.svn', '.idea', '.vscode',
    // Build output & caches
    'dist', 'build', 'target', '.gradle', 'coverage', '.cache',
  ];

  const shouldUploadFile = (file) => {
    const path = file.webkitRelativePath || file.name;

    // Skip heavy/irrelevant binaries (media, archives, executables, lockfiles).
    // Images and fonts are NOT skipped — they're carried in as base64 so the dev
    // server can resolve `import logo from './logo.png'` style asset imports.
    if (isSkippedAssetPath(path)) return false;

    // Skip files in excluded directories
    if (SKIP_DIRS.some(dir => path.includes(`/${dir}/`) || path.includes(`\\${dir}\\`))) return false;

    // Size cap: larger allowance for binary assets, tighter for text/source.
    const maxSize = isBinaryAssetPath(path) ? MAX_ASSET_SIZE : MAX_TEXT_SIZE;
    if (file.size > maxSize) return false;

    return true;
  };

  const readAndProcess = (allFiles) => {
    const projectFiles = [];
    let processed = 0;
    if (allFiles.length === 0) return;
    
    setIsUploading(true);
    allFiles.forEach((file) => {
      const path = file.webkitRelativePath || file.name;
      const reader = new FileReader();
      reader.onload = (event) => {
        projectFiles.push({ path, content: event.target.result });
        processed++;
        if (processed === allFiles.length) {
          const afterUpload = (sid) => {
            // Auto-detect project type after upload
            if (sid) {
              setTimeout(() => {
                detectProject(sid).then((result) => {
                  if (result?.projects?.length > 0) {
                    setDetectedProjects(result.projects);
                  }
                }).catch(() => { /* detection is best-effort */ });
              }, 500);
            }
          };

          if (sessionId) {
            uploadProject(sessionId, projectFiles)
              .then(() => {
                setProject(projectFiles);
                // Tell everyone else the file list changed. Without this the
                // upload is invisible to them — it goes over REST, so no edit
                // events are produced and they keep waiting for files that
                // have already arrived.
                if (currentUser) sendProjectSync(sessionId, currentUser.id);
                afterUpload(sessionId);
              })
              .finally(() => setIsUploading(false));
          } else {
            /* No session, and none is created. Importing is a private act:
             * these files open in the editor and stay on this machine, exactly
             * like opening a folder. Sharing is a separate, deliberate choice —
             * New Session or Join — and it should never happen as a side effect
             * of opening something.
             *
             * In the browser there is no disk to write back to, so they live in
             * the store, which is persisted; on the desktop this is only
             * reached for loose files picked outside any folder. */
            setProject(projectFiles);
            setIsUploading(false);
          }
        }
      };
      // Images/fonts → base64 data URL (decoded to real bytes on the server);
      // everything else → text.
      if (isBinaryAssetPath(path)) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
  };

  const handleFolderUpload = async (e) => {
    const allFiles = Array.from(e.target.files);
    if (allFiles.length === 0) return;

    /* Importing a folder is opening a folder.
     *
     * On the desktop the picked directory is a real place on disk, so it is
     * adopted as a local workspace — the same state as Open Folder. It used to
     * read every file into the renderer and then, finding no session to put
     * them in, create one; so "import" quietly turned a private project into a
     * shared session nobody asked for.
     *
     * Going through the folder path is also far cheaper: no reading, decoding
     * or uploading of a single file. */
    const first = allFiles[0];
    if (first?.webkitRelativePath && window.electronAPI?.getPathForFile && canOpenLocalFolder) {
      try {
        const abs = window.electronAPI.getPathForFile(first);
        const rel = first.webkitRelativePath;
        // abs ends with rel (same length, OS separators) — strip it to get
        // the parent dir, then re-append the project folder name.
        if (abs && abs.length > rel.length) {
          const parentDir = abs.slice(0, abs.length - rel.length);
          const root = parentDir + rel.split('/')[0];

          setIsUploading(true);
          setErrorMsg('');
          try {
            const result = await window.electronAPI.workspace.reopen(root);
            if (result) {
              openLocalWorkspace(result);
              if (result.truncated) {
                setErrorMsg(`LARGE PROJECT: showing the first ${result.files.length} files.`);
              }
              return;
            }
          } finally {
            setIsUploading(false);
          }
          // reopen returned nothing — fall through and load the picked files.
          setProjectRootPath(root);
        }
      } catch { /* browser mode, or the path could not be resolved */ }
    }

    const filesArray = allFiles.filter(shouldUploadFile);
    if (filesArray.length > 0) readAndProcess(filesArray);
  };

  const handleFileUpload = (e) => {
    const filesArray = Array.from(e.target.files).filter(f => f.size < 1024 * 1024);
    if (filesArray.length > 0) readAndProcess(filesArray);
  };

  /**
   * Open a folder from disk in local mode: files are read from and written back
   * to their real location, so no session is created and nothing is copied into
   * the database. Electron only — the browser has no filesystem access.
   */
  const handleOpenLocalFolder = async () => {
    const api = window.electronAPI?.workspace;
    if (!api) return;

    setIsUploading(true);
    setErrorMsg('');
    try {
      const result = await api.open();
      if (!result) return; // cancelled

      openLocalWorkspace(result);
      if (result.truncated) {
        setErrorMsg(`LARGE PROJECT: showing the first ${result.files.length} files.`);
      }
    } catch (err) {
      setErrorMsg(`COULD NOT OPEN FOLDER: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Take the shared project out of the session and onto this machine.
   *
   * A collaborator can join a project that exists nowhere on their own disk.
   * On the desktop the files are written into a folder they choose, which also
   * switches them into local mode so they are editing real files from then on.
   * In the browser there is no filesystem, so the project comes down as a zip.
   */
  const handleSaveProjectLocally = async () => {
    const store = useEditorStore.getState();
    const entries = Object.entries(store.files || {});
    if (entries.length === 0) {
      setErrorMsg('NOTHING TO SAVE YET — the project has no files.');
      return;
    }

    setIsUploading(true);
    setErrorMsg('');
    try {
      if (canOpenLocalFolder) {
        const placed = await window.electronAPI.workspace.materialize(Object.fromEntries(entries));
        if (!placed) return; // cancelled the folder picker
        openLocalWorkspace(placed);
        setErrorMsg(`SAVED ${placed.written} FILE(S) TO ${placed.root}`);
        return;
      }

      const { createZip, downloadBlob } = await import('../../utils/zip');
      const name = (store.sessionName || 'causify-project')
        .trim().replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'causify-project';
      downloadBlob(
        createZip(entries.map(([path, content]) => ({ path, content }))),
        `${name}.zip`
      );
    } catch (err) {
      setErrorMsg(`COULD NOT SAVE PROJECT: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Leave whatever is currently open.
   *
   * Telling the backend we left is what allows it to delete the session once the
   * last person is gone. A local workspace survives this — the files are on disk
   * and leaving a collaboration is not a reason to close the folder.
   */
  const handleDisconnect = async () => {
    const { sessionId: activeSession, currentUser: user } = useEditorStore.getState();

    if (activeSession) {
      try {
        await leaveSession(activeSession, user?.id);
      } catch (err) {
        // Best effort — the backend's sweep collects anything left behind.
        console.warn('[Causify] Could not notify the backend on leave:', err.message);
      }
      // Close the public route and point back at this machine. Both must
      // happen after the leave call above, which still needs the old origin
      // to reach the host we are leaving.
      try { await window.electronAPI?.tunnel?.stop(); } catch { /* best effort */ }
      resetOrigin();
      clearSessionToken();
      resetSession();
      return;
    }

    closeLocalWorkspace();
  };

  /**
   * The single entry point for "open a project folder".
   *
   * On the desktop this opens the folder in place: files are read from and
   * written back to their real location, and no session is created. The browser
   * has no filesystem access, so it falls back to the upload input, which copies
   * the project into a session as before.
   */
  const openProjectFolder = () => {
    if (canOpenLocalFolder) handleOpenLocalFolder();
    else folderInputRef.current?.click();
  };

  const primaryFolder = React.useMemo(() => {
    const fileKeys = Object.keys(files);
    if (fileKeys.length === 0) return '';
    const topFolders = Array.from(new Set(
      fileKeys
        .map(p => p.split('/')[0])
        .filter(firstPart => fileKeys.some(p => p.startsWith(firstPart + '/')))
    ));
    return topFolders.length > 0 ? topFolders[0] : '';
  }, [files]);

  const getSmartParentPath = () => {
    if (activePath) {
      const parts = activePath.split('/');
      if (parts.length > 1) {
        return parts.slice(0, -1).join('/');
      }
    }
    return primaryFolder || '';
  };

  /** "New file" / "New folder": lands inside active/primary folder or root. */
  const startNewFile = (type = 'file', targetParent = null) => {
    const parent = targetParent !== null ? targetParent : getSmartParentPath();
    if (parent) {
      setExpandedPaths((prev) => new Set(prev).add(parent));
    }
    setNewItem({ type, parent, name: '' });
  };

  const startNewFolder = (targetParent = null) => {
    startNewFile('folder', targetParent);
  };

  const handleCreateNew = async (e) => {
    if (e.key === 'Escape') { setNewItem(null); return; }
    if (e.key === 'Enter') {
      const name = e.target.value.trim();
      if (!name) { setNewItem(null); return; }

      const parentPath = newItem.parent;
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      const isFolder = newItem.type === 'folder';
      const pathToSave = isFolder ? `${fullPath}/.keep` : fullPath;

      // Local mode: create it on disk. No session, no upload — the file exists
      // where the user expects it and is visible to every other editor at once.
      if (workspaceRoot) {
        try {
          const target = absolutePathFor(isFolder ? fullPath : pathToSave);
          await window.electronAPI.workspace.create(target, isFolder);
          // For a folder this registers its .keep placeholder, which is what
          // keeps an otherwise empty directory visible in the tree.
          addFile(pathToSave, '');
          if (sessionId) {
            try {
              await saveFile(sessionId, pathToSave, '');
              if (currentUser) sendCodeChange(sessionId, currentUser.id, pathToSave, '');
            } catch { /* session sync best-effort */ }
          }
          setNewItem(null);
          setErrorMsg('');
        } catch (err) {
          setErrorMsg(`COULD NOT CREATE: ${err.message}`);
          setNewItem(null);
        }
        return;
      }

      if (!sessionId) {
        /* An untitled buffer, exactly as any editor makes one. It lives in
         * memory until the first save asks where to put it — no session
         * invented to hold it, and no dialog before there is anything to write.
         *
         * The browser used to create a session here for want of a filesystem,
         * which meant making a new file quietly published the project. The
         * store keeps it instead, and is persisted, so a refresh does not lose
         * it either. Sharing stays a deliberate act. */
        addFile(pathToSave, '');
        setNewItem(null);
        setErrorMsg('');
        return;
      }

      try {
        await saveFile(sessionId, pathToSave, '');
        addFile(pathToSave, '');
        if (currentUser) {
          sendCodeChange(sessionId, currentUser.id, pathToSave, '');
        }
        setNewItem(null);
        setErrorMsg('');
      } catch (err) {
        if (err.response?.status === 404) {
          setErrorMsg('SESSION EXPIRED: Please start/join a new session.');
          clearSessionToken();
      resetSession();
        } else {
          const msg = err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to create item';
          setErrorMsg(`SERVER ERROR: ${msg}`);
        }
      }
    }
  };

  const handleDelete = async (path, isFolder) => {
    /* The button is hidden for a locked file, but the keyboard and any future
       caller are not, and deleting one would destroy exactly what the lock was
       protecting. */
    if (useEditorStore.getState().isPathLockedForMe(path)) {
      setErrorMsg(`${path.split('/').pop()} is locked by ${lockedFiles[path]?.by || 'the owner'}.`);
      return;
    }

    // Check if the file has unsaved changes
    const isDirty = !isFolder && useEditorStore.getState().isFileDirty(path);

    // Local mode deletes the user's real file, so the main process runs its own
    // confirmation and sends it to the recycle bin. Only the unsaved-changes
    // warning is worth adding on top; a second generic prompt would be noise.
    if (workspaceRoot) {
      if (isDirty && !window.confirm(
        `"${path.split('/').pop()}" has unsaved changes.\n\nClick OK to continue, or Cancel to go back.`
      )) return;

      try {
        const result = await window.electronAPI.workspace.remove(absolutePathFor(path));
        if (result?.deleted) removeFile(path);
      } catch (err) {
        setErrorMsg(`COULD NOT DELETE: ${err.message}`);
      }
      return;
    }

    if (isDirty) {
      // Three-way dialog: Save / Don't Save / Cancel
      const choice = window.confirm(
        `"${path.split('/').pop()}" has unsaved changes.\n\nClick OK to delete anyway, or Cancel to go back.`
      );
      if (!choice) return; // Cancel
    } else {
      if (!window.confirm(`Delete ${isFolder ? 'folder' : 'file'} "${path}"?`)) return;
    }

    try {
      await deleteFile(sessionId, path);
      removeFile(path);
      // Tell the other collaborators to drop it from their tree too.
      if (sessionId && currentUser) sendFileDelete(sessionId, currentUser.id, path);
    } catch (err) {
      setErrorMsg('Failed to delete item');
    }
  };

  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const expandedInitRef = useRef(false);

  const toggleFolder = (path) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /**
   * Collapse the whole tree, or open it back up.
   *
   * Expanding rebuilds the same set the first-load effect builds — every
   * directory that has something in it — rather than remembering what was open
   * before. Restoring a half-open state nobody can see the shape of is more
   * surprising than simply showing the project.
   */
  const toggleCollapseAll = () => {
    setExpandedPaths((prev) => {
      if (prev.size > 0) return new Set();
      const all = new Set();
      Object.keys(files).forEach((p) => {
        const parts = p.split('/');
        let cur = '';
        for (let i = 0; i < parts.length - 1; i++) {
          cur = cur ? `${cur}/${parts[i]}` : parts[i];
          all.add(cur);
        }
      });
      return all;
    });
  };

  /**
   * "New file/folder" from a folder row: lands inside that folder.
   *
   * The toolbar buttons can only ever mean "at the top of the tree", which
   * leaves no way to put anything inside a project folder — the common case
   * once a folder is open. renderTree already knows how to show the name box
   * under a folder; it just needs to be told which one.
   *
   * Lives below expandedPaths deliberately: it reads that state, and declaring
   * it above would leave a hook one refactor away from a temporal-dead-zone
   * crash if it were ever called during render rather than from a click.
   */
  const startNewItemIn = (type, parentPath) => {
    // A collapsed folder would hide the name box we are about to show.
    setExpandedPaths((prev) => new Set(prev).add(parentPath));
    setNewItem({ type, parent: parentPath, name: '' });
  };

  // ── Minimal technical line-art icons ──
  const FileIcon = ({ name, isFolder, isOpen, size = 16 }) => {
    if (isFolder) {
      return (
        /* Filled rather than outlined, and warm rather than grey. An outline
           folder at this size competes with the filled, full-colour file icons
           beside it and loses, which leaves the structure of the tree reading
           as fainter than its contents. Two tones — a back flap and a lighter
           front — give it the depth that keeps it legible at 15px. */
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ transition: 'all 0.2s ease', flexShrink: 0 }}>
          <path d="M2 5.5A2 2 0 0 1 4 3.5h4.8l2 3H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-13z" fill={isOpen ? '#C98B2E' : '#8A7148'} />
          <path d="M2 9.2A1.8 1.8 0 0 1 3.8 7.4h16.4A1.8 1.8 0 0 1 22 9.2v9.3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.2z" fill={isOpen ? '#F0B45A' : '#B79A66'} />
        </svg>
      );
    }

    /* A handful of files are known by their name, not their extension, and they
       are usually the ones being scanned for. package.json is the npm mark
       rather than one more JSON blob among the rest. */
    const lower = name.toLowerCase();

    if (lower === 'package.json' || lower === 'package-lock.json') {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="24" rx="3" fill="#CB3837" />
          <path d="M5 8h14v8h-5.5v-5.5h-2.25V16H5V8z" fill="#FFFFFF" />
        </svg>
      );
    }

    if (lower === '.gitignore' || lower === '.gitattributes' || lower === '.gitmodules') {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="24" rx="3" fill="#F05033" />
          <circle cx="8" cy="8" r="1.9" fill="#FFFFFF" />
          <circle cx="8" cy="16" r="1.9" fill="#FFFFFF" />
          <circle cx="16" cy="12" r="1.9" fill="#FFFFFF" />
          <path d="M8 8v8M8 12h8" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    }

    if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="24" rx="3" fill="#2496ED" />
          <g fill="#FFFFFF">
            <rect x="5" y="12" width="2.6" height="2.6" rx="0.4" />
            <rect x="8.2" y="12" width="2.6" height="2.6" rx="0.4" />
            <rect x="11.4" y="12" width="2.6" height="2.6" rx="0.4" />
            <rect x="8.2" y="8.8" width="2.6" height="2.6" rx="0.4" />
            <rect x="11.4" y="8.8" width="2.6" height="2.6" rx="0.4" />
          </g>
          <path d="M15 13.2c1.6 0 3-.5 3.9-1.4.3.9.1 2.2-.8 3.1-1 1-2.6 1.6-4.6 1.6H5.4" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      );
    }

    if (lower === '.env' || lower.startsWith('.env.')) {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="24" rx="3" fill="#1A1A1A" stroke="#FFB224" strokeWidth="1.2" />
          <circle cx="9.5" cy="12" r="2.6" stroke="#FFB224" strokeWidth="1.6" fill="none" />
          <path d="M12 12h6.5M16 12v2.6" stroke="#FFB224" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    }

    const ext = name.split('.').pop()?.toLowerCase();

    switch (ext) {
      case 'html':
      case 'htm':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 2L4.67 19.34L12 21.38L19.33 19.34L21 2H3Z" fill="#E34F26"/>
            <path d="M12 3.66V19.46L17.5 17.9L18.8 4.7L12 3.66Z" fill="#F06529"/>
            <path d="M12 8.78H8.84L9 10.3H12V8.78ZM12 11.8H9.15L9.5 15.35L12 16.05V11.8Z" fill="#EBEBEB"/>
            <path d="M12 8.78V10.3H15.04L14.75 13.3L12 14.05V15.58L14.6 14.86L15.3 7H12V8.78Z" fill="#FFFFFF"/>
          </svg>
        );
      case 'css':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 2L4.67 19.34L12 21.38L19.33 19.34L21 2H3Z" fill="#1572B6"/>
            <path d="M12 3.66V19.46L17.5 17.9L18.8 4.7L12 3.66Z" fill="#33A9DC"/>
            <path d="M12 8.78H7.32L7.6 11.8H12V8.78ZM12 14.8L9.5 14.12L9.36 12.6H6.3L6.58 15.8L12 17.3V14.8Z" fill="#EBEBEB"/>
            <path d="M12 8.78V11.8H14.7L14.4 14.8L12 15.48V17.3L17.42 15.8L18.1 8H12V8.78Z" fill="#FFFFFF"/>
          </svg>
        );
      case 'js':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#F7DF1E"/>
            <path d="M18.86 16.92C18.43 17.9 17.53 18.52 16.27 18.52C14.78 18.52 13.78 17.55 13.78 15.32H15.15C15.15 16.73 15.68 17.39 16.3 17.39C16.9 17.39 17.39 17.06 17.39 16.03V10.15H18.86V16.92ZM11.16 16.9C10.79 17.86 9.87 18.52 8.44 18.52C6.88 18.52 5.92 17.45 5.92 15.32H7.29C7.29 16.85 7.84 17.39 8.46 17.39C9.07 17.39 9.5 17.02 9.5 16.38C9.5 15.65 9.17 15.28 8.1 14.8L7.13 14.37C5.9 13.82 5.25 13.06 5.25 11.66C5.25 9.77 6.64 8.78 8.35 8.78C9.9 8.78 10.86 9.68 11.16 11.23H9.8C9.62 10.36 9.15 9.9 8.41 9.9C7.8 9.9 7.37 10.27 7.37 10.87C7.37 11.45 7.69 11.77 8.52 12.13L9.5 12.56C11.05 13.24 11.83 14.07 11.83 15.54C11.83 15.56 11.83 15.58 11.83 15.6V15.63C11.83 15.65 11.83 15.66 11.83 15.68C11.75 16.14 11.53 16.56 11.16 16.9Z" fill="#000000"/>
          </svg>
        );
      case 'ts':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#3178C6"/>
            <path d="M12.92 18.52H14.39V10.15H18.86V8.78H8.44V10.15H12.92V18.52ZM7.78 12.55C6.9 12.16 6.3 11.75 6.3 10.87C6.3 10.27 6.73 9.9 7.33 9.9C7.94 9.9 8.4 10.36 8.58 11.23H9.95C9.65 9.68 8.68 8.78 7.14 8.78C5.43 8.78 4.04 9.77 4.04 11.66C4.04 13.06 4.7 13.82 5.92 14.37L6.89 14.8C7.96 15.28 8.29 15.65 8.29 16.38C8.29 17.02 7.86 17.39 7.25 17.39C6.63 17.39 6.08 16.85 6.08 15.32H4.7C4.7 17.55 5.7 18.52 7.2 18.52C8.63 18.52 9.55 17.86 9.92 16.9C10.29 15.94 10.62 15.54 9.62 15.08L8.64 14.65C8.3 14.5 8.01 14.37 7.78 12.55Z" fill="#FFFFFF"/>
          </svg>
        );
      case 'jsx':
      case 'tsx':
        return (
          <svg width={size} height={size} viewBox="-11.5 -10.23174 23 20.46348" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="0" cy="0" r="2.05" fill="#61DAFB"/>
            <g stroke="#61DAFB" strokeWidth="1.2" fill="none">
              <ellipse rx="11" ry="4.2"/>
              <ellipse rx="11" ry="4.2" transform="rotate(60)"/>
              <ellipse rx="11" ry="4.2" transform="rotate(120)"/>
            </g>
          </svg>
        );
      case 'json':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#2F2F2F" stroke="#4F4F4F" strokeWidth="1"/>
            <path d="M9 7C9 5.34 10.34 4 12 4V5.5C11.17 5.5 10.5 6.17 10.5 7V10C10.5 10.83 9.83 11.5 9 11.5C9.83 11.5 10.5 12.17 10.5 13V16C10.5 16.83 11.17 17.5 12 17.5V19C10.34 19 9 17.66 9 16V13C9 12.72 8.78 12.5 8.5 12.5H7.5V11.5H8.5C8.78 11.5 9 11.28 9 11V7Z" fill="#3DD68C"/>
            <path d="M15 7C15 5.34 13.66 4 12 4V5.5C12.83 5.5 13.5 6.17 13.5 7V10C13.5 10.83 14.17 11.5 15 11.5C14.17 11.5 13.5 12.17 13.5 13V16C13.5 16.83 12.83 17.5 12 17.5V19C13.66 19 15 17.66 15 16V13C15 12.72 15.22 12.5 15.5 12.5H16.5V11.5H15.5C15.22 11.5 15 11.28 15 11V7Z" fill="#3DD68C"/>
          </svg>
        );
      case 'md':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#0A0A0A" stroke="#EDEDED" strokeWidth="1"/>
            <path d="M4 7H6V11L8 8L10 11V7H12V15H10L8 12L6 15H4V7Z" fill="#FFFFFF"/>
            <path d="M17 7V11H19.5L16.5 15L13.5 11H16V7H17Z" fill="#FFFFFF"/>
          </svg>
        );
      case 'py':
      case 'pyw':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.14 2C9.57 2 7.78 3.57 7.78 5.75V7.4H12.2V8.04H6V11.96C6 14.14 7.78 15.71 10.35 15.71H11.75V14.06C11.75 11.88 13.53 10.31 16.1 10.31H20.3V5.75C20.3 3.57 18.52 2 15.95 2H12.14ZM10.5 4.5C10.91 4.5 11.25 4.84 11.25 5.25C11.25 5.66 10.91 6 10.5 6C10.09 6 9.75 5.66 9.75 5.25C9.75 4.84 10.09 4.5 10.5 4.5Z" fill="#3776AB"/>
            <path d="M11.86 22C14.43 22 16.22 20.43 16.22 18.25V16.6H11.8V15.96H18V12.04C18 9.86 16.22 8.29 13.65 8.29H12.25V9.94C12.25 12.12 10.47 13.69 7.9 13.69H3.7V18.25C3.7 20.43 5.48 22 8.05 22H11.86ZM13.5 19.5C13.09 19.5 12.75 19.16 12.75 18.75C12.75 18.34 13.09 18 13.5 18C13.91 18 14.25 18.34 14.25 18.75C14.25 19.16 13.91 19.5 13.5 19.5Z" fill="#FFE873"/>
          </svg>
        );
      case 'cpp':
      case 'cc':
      case 'cxx':
      case 'hpp':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#00599C"/>
            <path d="M11 7.5H7.5V16.5H11" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M15 10V14M13 12H17" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M19 10V14M17 12H21" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        );
      case 'c':
      case 'h':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#659AD2"/>
            <path d="M15 7.5H9.5V16.5H15" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        );
      case 'java':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#EA2D2E"/>
            <path d="M7 10H15L14 18H8L7 10Z" fill="#FFFFFF"/>
            <path d="M15 11C16.5 11 17.5 12 17.5 13.5C17.5 15 16.5 16 15 16" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M9 5C9 7 10 7 10 9M12 4C12 6 13 6 13 8" stroke="#FFFFFF" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        );
      case 'pdf':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7z" fill="#E5484D" />
            <path d="M13 2v7h7" fill="#FF8A8D" />
            <path d="M7.2 18.2v-4.6h1.7a1.4 1.4 0 0 1 0 2.8H7.2M11.6 18.2v-4.6h1a1.9 2.3 0 0 1 0 4.6h-1M16.9 18.2v-4.6h2.2M16.9 16h1.7"
              stroke="#FFFFFF" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        );
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp':
      case 'bmp':
      case 'ico':
      case 'avif':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2.5" y="4" width="19" height="16" rx="2.5" fill="#1E2A3A" stroke="#7C6BF0" strokeWidth="1.4" />
            <circle cx="8.5" cy="9.5" r="1.6" fill="#FFD166" />
            <path d="M4 17l4.5-4.6 3.2 3.2 3-3L20 17.5" stroke="#7C6BF0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        );
      case 'svg':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#FFB13B" />
            <circle cx="12" cy="12" r="3.2" fill="#FFFFFF" />
            <path d="M12 4.6v3M12 16.4v3M4.6 12h3M16.4 12h3" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        );
      case 'go':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#00ADD8" />
            <path d="M9.6 9.6a3.4 3.4 0 1 0 3.2 4.5H10.4" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="16.4" cy="12.4" r="2.9" stroke="#FFFFFF" strokeWidth="1.8" fill="none" />
          </svg>
        );
      case 'rs':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#1A1A1A" stroke="#DEA584" strokeWidth="1.2" />
            <path d="M8 17V7.6h4.2a2.5 2.5 0 0 1 0 5H8m4.4 0l3.4 4.4" stroke="#DEA584" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        );
      case 'vue':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 4h4.2L12 14.2 17.8 4H22L12 21.2 2 4z" fill="#41B883" />
            <path d="M6.9 4h3.1L12 7.6 14 4h3.1L12 12.8 6.9 4z" fill="#35495E" />
          </svg>
        );
      case 'sql':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="12" cy="6.4" rx="7.2" ry="2.9" fill="#00758F" />
            <path d="M4.8 6.4v11.2c0 1.6 3.2 2.9 7.2 2.9s7.2-1.3 7.2-2.9V6.4" fill="#00758F" opacity="0.55" />
            <path d="M4.8 11.9c0 1.6 3.2 2.9 7.2 2.9s7.2-1.3 7.2-2.9" stroke="#8ED6E8" strokeWidth="1.3" fill="none" />
          </svg>
        );
      case 'sh':
      case 'bash':
      case 'zsh':
      case 'ps1':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2.5" y="4" width="19" height="16" rx="2.5" fill="#1A1A1A" stroke="#3DD68C" strokeWidth="1.4" />
            <path d="M6.6 9.4l3.2 2.7-3.2 2.7M12.4 15.2h5" stroke="#3DD68C" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );
      case 'yml':
      case 'yaml':
      case 'toml':
      case 'ini':
      case 'conf':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#1A1A1A" stroke="#B3B3B3" strokeWidth="1.2" />
            <path d="M6 8.5h4M6 12h8M6 15.5h5" stroke="#B3B3B3" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="17" cy="8.5" r="1.3" fill="#FFB224" />
          </svg>
        );
      case 'xml':
      case 'svgz':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="3" fill="#1A1A1A" stroke="#E37933" strokeWidth="1.2" />
            <path d="M9 9l-3 3 3 3M15 9l3 3-3 3M13.2 7.6l-2.4 8.8" stroke="#E37933" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );
      case 'zip':
      case 'rar':
      case 'gz':
      case 'tar':
      case '7z':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 7.4l9-4.4 9 4.4v9.2l-9 4.4-9-4.4V7.4z" fill="#1A1A1A" stroke="#FFB224" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M12 3v18M3 7.4l9 4.4 9-4.4" stroke="#FFB224" strokeWidth="1.2" opacity="0.7" />
          </svg>
        );
      case 'txt':
      case 'log':
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7z" fill="#242424" stroke="#9A9A9A" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M7.6 12h8.8M7.6 15h8.8M7.6 18h5.4" stroke="#9A9A9A" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        );
      default:
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#C8C8C8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="13 2 13 9 20 9" />
          </svg>
        );
    }
  };

  // Auto-expand all folders on first load (moved out of render to avoid infinite loop)
  useEffect(() => {
    const allPaths = Object.keys(files);
    if (!expandedInitRef.current && allPaths.length > 0) {
      expandedInitRef.current = true;
      const initialExpanded = new Set();
      allPaths.forEach(p => {
        const parts = p.split('/');
        let cur = '';
        for (let i = 0; i < parts.length - 1; i++) {
          cur = cur ? `${cur}/${parts[i]}` : parts[i];
          initialExpanded.add(cur);
        }
      });
      setExpandedPaths(initialExpanded);
    }
  }, [files]);

  const buildTree = (filesObj) => {
    const tree = {};
    // Hide the same heavy dependency/build dirs we skip on import, plus OS cruft.
    // Guards older sessions whose files were uploaded before the skip list grew.
    const hiddenEntries = new Set([...SKIP_DIRS, '.DS_Store']);
    const allPaths = Object.keys(filesObj);

    allPaths.forEach((path) => {
      if (path.split('/').some(p => hiddenEntries.has(p))) return;
      const parts = path.split('/');
      let current = tree;
      parts.forEach((part, index) => {
        if (!current[part]) current[part] = index === parts.length - 1 ? null : {};
        current = current[part];
      });
    });
    return tree;
  };

  const tree = buildTree(files);

  /* Shared by the hover-revealed row actions so they line up with delete. */
  const rowActionStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '18px', height: '18px', flexShrink: 0,
    background: 'transparent', border: 'none', borderRadius: '3px',
    color: 'var(--t3)', cursor: 'pointer', padding: 0,
  };

  const FileItem = ({ name, path, isFolder, depth = 1 }) => {
    const isActive = activePath === path;
    const activeEditor = fileActivity[path];
    const isAffected = affectedPaths.has(path);

    /* Rows are laid out flat and indented by padding rather than by nesting, so
       the selection can run the full width of the panel the way a file tree's
       selection is expected to. `indent` is how many levels of guide line sit
       to the left of this row; a top-level row has none.

       Hover used to be a useState per row, which meant a state update and a
       re-render every time the pointer crossed a filename. It is CSS now: the
       same look, none of the work, and it cannot fall out of sync. */
    const indent = Math.max(0, depth - 1);

    // Users (other than me) currently working in this file.
    const presentUsers = isFolder ? [] : Object.entries(filePresence)
      .filter(([uid, p]) => p.path === path && uid !== currentUser?.id)
      .map(([uid, p]) => ({ uid, ...p }));

    const lock = isFolder ? null : lockedFiles[path];
    const lockedForMe = Boolean(lock) && !isOwner;

    const extension = name.includes('.') ? name.split('.').pop().toUpperCase() : '';
    const nameOnly = name.includes('.') ? name.substring(0, name.lastIndexOf('.')) : name;

    // Git state for this entry. Folders take the most urgent state inside them,
    // so a change is visible without expanding the tree to find it.
    const gitDecoration = decorationFor(path, gitFileStatus, isFolder);

    return (
      <div
        className={`fx-file-item${isActive ? ' is-active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (isFolder) toggleFolder(path);
          else openFile(path);
        }}
        title={path}
        style={{ paddingLeft: `${8 + indent * FX_INDENT}px` }}
      >
        {/* One continuous rule per ancestor level. Drawn per row rather than as
            a border on a wrapper, because the rows are siblings now — and since
            each rule spans the row's full height, adjacent rows join into the
            single unbroken line the nested version used to give for free. */}
        {Array.from({ length: indent }, (_, i) => (
          /* Sits on the centre of the ancestor's chevron: that row's padding is
             8 + i·FX_INDENT and the chevron column is 14 wide, so its centre is
             7 further in. */
          <span key={i} className="fx-guide" style={{ left: `${8 + i * FX_INDENT + 7}px` }} />
        ))}

        {isFolder ? (
          <span className={`fx-chev${expandedPaths.has(path) ? ' is-open' : ''}`}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        ) : (
          /* Files have no chevron, but their icons still have to line up with
             the folder icons above them — so the column is held open. */
          <span className="fx-chev-gap" />
        )}

        {/* One row shape for both kinds of entry.
            A folder is named the same way a file is: shouting it in uppercase
            display type made every folder outrank the files inside it, which is
            backwards — the folder is the container, the file is the thing you
            are looking for. It is told apart by its icon and chevron instead.
            And a filename is one word: app.js, not a display-font stem plus an
            uppercase extension pill, which turned eight files into twenty-four
            competing objects and repeated in text what the icon already says in
            colour.

            Colour and weight come from CSS so the whole row shifts together on
            hover and selection. Git state is the exception and stays inline —
            an edited file should read as edited whatever else is going on. */}
        <span className="fx-row-main">
          <FileIcon name={name} isFolder={isFolder} isOpen={isFolder && expandedPaths.has(path)} size={16} />
          <span className="fx-row-name" style={gitDecoration ? { color: gitDecoration.color } : undefined}>
            {name}
          </span>
        </span>

        {isAffected && !isFolder && (
          <div title="Affected by recent change" style={{ width: '5px', height: '5px', background: 'var(--amber)', borderRadius: '50%', animation: 'hud-pulse 1.4s infinite' }} />
        )}

        {/* Presence: who is currently working in this file */}
        {/* Git state letter — M, U, D, A, R. The colour alone would not survive
            a colour-blind reader or a glance, so the letter carries it too. */}
        {gitDecoration && (
          <span
            title={`${gitDecoration.label}${isFolder ? ' (inside this folder)' : ''}`}
            style={{
              fontFamily: 'var(--font-number)',
              fontSize: '0.5rem',
              fontWeight: 800,
              color: gitDecoration.color,
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            {gitDecoration.letter}
          </span>
        )}

        {presentUsers.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
            title={`${presentUsers.map((u) => u.username).join(', ')} working here`}>
            {presentUsers.slice(0, 3).map((u, i) => (
              <div key={u.uid} style={{
                width: '14px', height: '14px', borderRadius: '3px',
                background: u.color || '#6366f1',
                border: '1px solid var(--s1)',
                marginLeft: i === 0 ? 0 : '-4px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.42rem', fontWeight: 800, color: '#0A0A0A',
                fontFamily: 'var(--font-number)',
                boxShadow: `0 0 5px ${u.color || '#6366f1'}66`,
              }}>
                {(u.username || '?').charAt(0).toUpperCase()}
              </div>
            ))}
            {presentUsers.length > 3 && (
              <span style={{
                marginLeft: '3px', fontSize: '0.42rem', color: 'var(--t3)',
                fontFamily: 'var(--font-number)', fontWeight: 700,
              }}>+{presentUsers.length - 3}</span>
            )}
          </div>
        )}

        {activeEditor && !isFolder && (
          <div style={{
            padding: '1px 3px', fontSize: '0.4rem', fontFamily: 'var(--font-number)',
            background: 'var(--cyan-dim)', border: '1px solid var(--cyan-line)',
            borderRadius: '2px', color: 'var(--cyan)', letterSpacing: '0.08em',
            fontWeight: 600
          }}>
            LIVE
          </div>
        )}

        {/* A frozen file says so on its row, always — not only on hover and not
            only once you have opened it and found the editor refusing to type.
            The owner sees the same mark, since they are the one who has to
            remember it is set. */}
        {lock && (
          <div
            title={`Locked by ${lock.by || 'the owner'}${isOwner ? ' — click the padlock to unlock' : ''}`}
            style={{
              display: 'flex', alignItems: 'center', flexShrink: 0,
              color: '#FFB224', opacity: 0.9,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        )}

        {/* Owner's toggle. Hover-revealed like the other row actions, and only
            for real files — locking a folder would imply a rule about paths
            that do not exist yet. */}
        {isOwner && sessionId && !isFolder && (
          <button
            className="fx-file-del"
            onClick={(e) => { e.stopPropagation(); toggleFileLock(path); }}
            title={lock ? `Unlock ${name}` : `Lock ${name} — only you will be able to edit it`}
            style={rowActionStyle}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#FFB224'; e.currentTarget.style.background = 'rgba(255,178,36,0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.background = 'transparent'; }}
          >
            {lock ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
          </button>
        )}

        {/* Create inside this folder. Without these the toolbar's only meaning
            is "at the top of the tree", so there is no way to put a file where
            it belongs once a project folder is open. Same hover reveal as
            delete. */}
        {canEdit && isFolder && (
          <>
            <button
              className="fx-file-del"
              onClick={(e) => { e.stopPropagation(); startNewItemIn('file', path); }}
              title={`New file in ${name}`}
              style={rowActionStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--lime)'; e.currentTarget.style.background = 'var(--lime-dim)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </button>
            <button
              className="fx-file-del"
              onClick={(e) => { e.stopPropagation(); startNewItemIn('folder', path); }}
              title={`New folder in ${name}`}
              style={rowActionStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--lime)'; e.currentTarget.style.background = 'var(--lime-dim)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            </button>
          </>
        )}

        {/* Delete — owner & editor collaborators only. Visibility is CSS-driven
            (revealed on row :hover) so it survives parent re-renders.
            A locked file cannot be deleted either: freezing its contents while
            leaving "remove the whole thing" available protects nothing. */}
        {canEdit && !lockedForMe && (
          <button
            className="fx-file-del"
            onClick={(e) => { e.stopPropagation(); handleDelete(path, isFolder); }}
            title={`Delete ${isFolder ? 'folder' : 'file'}`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '18px', height: '18px', flexShrink: 0,
              background: 'transparent', border: 'none', borderRadius: '3px',
              color: 'var(--t3)', cursor: 'pointer', padding: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--crimson)'; e.currentTarget.style.background = 'rgba(232,17,35,0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        )}
      </div>
    );
  };

  const NewItemForm = ({ isInline = false }) => {
    if (!newItem) return null;
    const isFolder = newItem.type === 'folder';
    const isRoot = !newItem.parent;

    const toggleLocation = () => {
      if (isRoot) {
        const target = primaryFolder || getSmartParentPath() || '';
        if (target) {
          setExpandedPaths((prev) => new Set(prev).add(target));
          setNewItem((prev) => ({ ...prev, parent: target }));
        }
      } else {
        setNewItem((prev) => ({ ...prev, parent: '' }));
      }
    };

    return (
      <div className="fx-new-item-form" style={{
        padding: '6px 10px',
        /* Inline, this box stands in for a row inside `newItem.parent`, so it
           lines up on the same indent grid the rows use. It used to inherit
           that from the padded wrapper each folder drew around its children;
           with the tree flattened there is no wrapper to inherit from, and the
           box would otherwise sit flush against the panel edge no matter how
           deep the folder it belongs to. */
        margin: isInline
          ? `4px 8px 4px ${8 + newItem.parent.split('/').length * FX_INDENT}px`
          : '6px 14px',
        background: 'var(--s0)',
        border: '1px solid var(--line-strong)',
        borderRadius: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.52rem',
          fontFamily: 'var(--font-number)',
          fontWeight: 700,
          letterSpacing: '0.04em'
        }}>
          <span style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: isRoot ? 'var(--amber)' : 'var(--lime)'
          }}>
            {isRoot ? '🌐 Target: Root (Outside Project)' : `📁 Target: ${newItem.parent}/`}
          </span>
          {primaryFolder && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); toggleLocation(); }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleLocation(); }}
              title={isRoot ? `Create inside ${primaryFolder}/` : 'Create outside (at root level)'}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--line)',
                borderRadius: '3px',
                color: 'var(--t1)',
                fontSize: '0.5rem',
                fontWeight: 800,
                padding: '2px 6px',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}
            >
              {isRoot ? `Switch to ${primaryFolder}/` : 'Switch to Root'}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileIcon name={newItem.name || 'new'} isFolder={isFolder} />
          <input
            autoFocus
            onKeyDown={handleCreateNew}
            onBlur={(e) => {
              if (e.relatedTarget && e.currentTarget.closest('.fx-new-item-form')?.contains(e.relatedTarget)) {
                return;
              }
              setNewItem(null);
            }}
            style={{
              ...inputStyle,
              marginBottom: 0,
              height: '24px',
              flex: 1,
              border: 'none',
              background: 'transparent',
              outline: 'none'
            }}
            placeholder={isFolder ? 'Folder name...' : 'File name...'}
          />
        </div>
      </div>
    );
  };

  /**
   * The tree, flattened into one list of rows.
   *
   * It used to nest: each folder wrapped its children in a padded div carrying
   * the indent guide as a left border. That reads well until you want the
   * selected row highlighted, because a nested row's background can only ever
   * start where its wrapper starts — so the highlight stopped short of the
   * panel edge and grew a staircase down the left as the tree got deeper.
   *
   * Rows are siblings now, indented by their own padding, which lets the
   * highlight run edge to edge. The guides are drawn per row instead (see
   * FileItem) and join up because every row draws them full height.
   *
   * Returns an array of rows rather than a wrapper element — the caller drops
   * them straight into the scroll container.
   */
  const renderTree = (node, name = '', currentPath = '', depth = 0) => {
    const path = currentPath ? (name ? `${currentPath}/${name}` : currentPath) : name;
    const isFolder = node !== null;
    const isExpanded = depth === 0 || expandedPaths.has(path);

    if (!isFolder) {
      return [<FileItem key={path} name={name} path={path} isFolder={false} depth={depth} />];
    }

    const rows = [];
    if (name) rows.push(<FileItem key={path} name={name} path={path} isFolder={true} depth={depth} />);

    if (isExpanded) {
      if (newItem && newItem.parent === path && name) {
        rows.push(<NewItemForm key={`${path}::new`} isInline={true} />);
      }
      Object.entries(node)
        .sort(([aName, aNode], [bName, bNode]) => {
          const aIsFolder = aNode !== null;
          const bIsFolder = bNode !== null;
          if (aIsFolder && !bIsFolder) return -1;
          if (!aIsFolder && bIsFolder) return 1;
          return aName.localeCompare(bName);
        })
        .forEach(([childName, childNode]) => {
          rows.push(...renderTree(childNode, childName, path, depth + 1));
        });
    }

    return rows;
  };

  const sectionLabelSty = {
    fontSize: '0.54rem',
    fontWeight: 700,
    color: 'var(--t3)',
    marginBottom: '14px',
    letterSpacing: '0.08em',
    fontFamily: 'var(--font-header)',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  };

  const inputStyle = {
    width: '100%',
    height: '34px',
    padding: '0 10px',
    background: 'var(--s0)',
    border: '1px solid var(--line-strong)',
    borderRadius: '4px',
    color: 'var(--t1)',
    fontSize: '0.74rem',
    outline: 'none',
    marginBottom: '12px',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
    fontFamily: 'var(--font-body)',
    fontWeight: 500,
  };


  const btnStyle = (isPrimary) => ({
    width: '100%',
    height: '34px',
    border: `1px solid ${isPrimary ? '#FFFFFF' : 'var(--line-strong)'}`,
    background: isPrimary ? '#FFFFFF' : 'var(--s2)',
    color: isPrimary ? '#0A0A0A' : 'var(--t1)',
    fontFamily: 'var(--font-body)',
    fontWeight: 600,
    fontSize: '0.72rem',
    cursor: 'pointer',
    marginBottom: '6px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'background 0.15s ease',
    letterSpacing: '0.01em',
    position: 'relative',
    overflow: 'hidden'
  });

  const explorerActionBtnSty = { background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: '6px', borderRadius: '4px', display: 'flex', alignItems: 'center', transition: 'all 0.15s' };

  const labelStyle = { 
    fontSize: '0.54rem', 
    color: 'var(--t3)', 
    fontFamily: 'var(--font-number)', 
    fontWeight: 600,
    letterSpacing: '0.08em', 
    textTransform: 'uppercase',
    display: 'block',
    marginBottom: '6px'
  };

  const backBtnStyle = { background: 'none', border: 'none', color: 'var(--t3)', fontSize: '0.64rem', fontFamily: 'var(--font-body)', cursor: 'pointer', width: '100%', marginTop: '6px' };

  const primaryActionSty = {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    padding: '12px 14px',
    background: hoveredIndex === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.015)',
    color: 'var(--t1)',
    border: `1px solid ${hoveredIndex === 0 ? 'rgba(255,255,255,0.2)' : 'var(--line-strong)'}`,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background 0.15s ease, border-color 0.15s ease',
  };

  const secondaryActionSty = (index) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    padding: '10px 12px',
    background: hoveredIndex === index ? 'rgba(255,255,255,0.04)' : 'transparent',
    border: `1px solid ${hoveredIndex === index ? 'rgba(255,255,255,0.1)' : 'transparent'}`,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background 0.12s ease, border-color 0.12s ease',
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--s1)', borderRight: '1px solid var(--line)', width: '100%', userSelect: 'none', position: 'relative' }}>
      {isUploading && <LoadingOverlay />}
      {isLoading && <MarioLoader title="Creating Workspace" subtitle="Initializing your file…" />}
      <input ref={folderInputRef} type="file" webkitdirectory="" mozdirectory="" directory="" style={{ display: 'none' }} onChange={handleFolderUpload} />
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileUpload} />

      <div style={{ padding: '12px 14px', fontFamily: 'var(--font-header)', fontSize: '0.56rem', fontWeight: 700, color: 'var(--t3)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        <span>Explorer</span>
        <button onClick={onToggle} title="Collapse Sidebar" style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--t1)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--t3)'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <div>
        {/* Workspaces / session actions — only for a truly empty window.
            A restored workspace (files, no session) opens straight into
            Project Files; Alt+N / Alt+J can still summon the forms.
            Hidden while a new-file input is active so the input sits at
            the top of the sidebar instead of below the fold. */}
        {!sessionId && (Object.keys(files).length === 0 || panel) && !newItem && (
          <div style={{
            padding: '22px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            color: 'var(--t1)'
          }}>
            <div style={{ paddingTop: '4px' }}>
              {/* Creative "Workspaces" Typography */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line-faint)' }}>
                {/* VT323, the same face as the terminal. A pixel font needs the
                    opposite typographic treatment to Unbounded: it renders small
                    for its em so the size goes up, it has one weight so 900 is
                    meaningless, and it wants tracking opened out rather than
                    tightened — negative letter-spacing closes up the gaps the
                    pixel grid depends on. */}
                {/* One uniform treatment across the whole word — hollow pixel
                    letters throughout, rather than a solid half and an outlined
                    half. */}
                <span style={{
                  fontFamily: "'VT323', 'Silkscreen', monospace",
                  fontSize: '1.9rem',
                  fontWeight: 400,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  lineHeight: 1,
                  color: 'transparent',
                  WebkitTextStrokeWidth: '1px',
                  WebkitTextStrokeColor: 'rgba(255,255,255,0.7)'
                }}>
                  Workspaces
                </span>
              </div>
            </div>

            {!panel && (
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: '8px' }}>
                {/* Header */}
                <div style={{
                  fontFamily: 'var(--font-number)',
                  fontSize: '0.52rem',
                  letterSpacing: '0.18em',
                  color: 'var(--t4)',
                  textTransform: 'uppercase',
                  paddingLeft: '2px',
                  marginBottom: '10px'
                }}>
                  Session Actions
                </div>

                {/* Vertical menu list */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {[
                    {
                      id: 0,
                      num: '01',
                      title: 'New Session',
                      desc: 'Initialize collaborative room',
                      shortcut: 'N',
                      onClick: () => setPanel('create')
                    },
                    {
                      id: 1,
                      num: '02',
                      title: 'Join Session',
                      desc: 'Connect to an active room ID',
                      shortcut: 'J',
                      onClick: () => setPanel('join')
                    },
                    {
                      id: 2,
                      num: '03',
                      title: 'Import Project',
                      desc: 'Load local repository folder',
                      shortcut: 'I',
                      onClick: () => openProjectFolder()
                    },
                    {
                      id: 3,
                      num: '04',
                      title: 'New File',
                      desc: 'Create blank text buffer',
                      shortcut: 'F',
                      onClick: () => startNewFile()
                    }
                  ].map((a) => {
                    const isHovered = hoveredIndex === a.id;
                    return (
                      <div
                        key={a.id}
                        onClick={a.onClick}
                        onMouseEnter={() => setHoveredIndex(a.id)}
                        onMouseLeave={() => setHoveredIndex(null)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '16px 0',
                          borderBottom: '1px solid var(--line-faint)',
                          cursor: 'pointer',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        {/* Number / Arrow sliding indicator */}
                        <div style={{
                          fontFamily: 'var(--font-number)',
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          color: isHovered ? 'transparent' : 'var(--t4)',
                          width: '24px',
                          transition: 'color 0.2s ease, opacity 0.2s ease, transform 0.2s ease',
                          transform: isHovered ? 'translateX(-10px)' : 'none',
                          opacity: isHovered ? 0 : 1,
                          display: 'flex',
                          alignItems: 'center',
                          flexShrink: 0
                        }}>
                          {a.num}
                        </div>

                        <div style={{
                          position: 'absolute',
                          left: 0,
                          top: '50%',
                          transform: isHovered ? 'translateY(-50%) translateX(0)' : 'translateY(-50%) translateX(-20px)',
                          opacity: isHovered ? 1 : 0,
                          color: 'var(--lime)',
                          transition: 'opacity 0.2s ease, transform 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          flexShrink: 0
                        }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <polyline points="12 5 19 12 12 19" />
                          </svg>
                        </div>

                        {/* Title & Desc shifting container */}
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          transition: 'transform 0.2s ease',
                          transform: isHovered ? 'translateX(28px)' : 'translateX(0)',
                          flex: 1,
                          minWidth: 0
                        }}>
                          <span style={{
                            fontFamily: 'var(--font-header)',
                            fontSize: '0.98rem',
                            fontWeight: 800,
                            letterSpacing: '-0.03em',
                            textTransform: 'uppercase',
                            color: isHovered ? '#FFFFFF' : 'var(--t2)',
                            transition: 'color 0.2s ease',
                            lineHeight: 1.1
                          }}>
                            {a.title}
                          </span>
                          <span style={{
                            fontFamily: 'var(--font-body)',
                            fontSize: '0.62rem',
                            fontWeight: 400,
                            color: isHovered ? 'var(--t3)' : 'var(--t4)',
                            transition: 'color 0.2s ease',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            {a.desc}
                          </span>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {newItem && newItem.parent === '' && (
              <NewItemForm isInline={false} />
            )}

            {panel === 'create' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>Your name</label>
                  <input style={inputStyle} value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter your name" />
                </div>
                <div>
                  <label style={labelStyle}>Project name</label>
                  <input style={inputStyle} value={projName} onChange={e => setProjName(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>Password</label>
                  <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="0000" />
                </div>
                <button style={btnStyle(true)} onClick={() => handleCreate()}>{isLoading ? 'Initializing…' : 'Create & Start'}</button>
                <button style={backBtnStyle} onClick={() => setPanel(null)}>← Back</button>
              </div>
            )}

            {panel === 'join' && !waiting && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <label style={labelStyle}>Your name</label>
                  <input style={inputStyle} value={joinUsername} onChange={e => setJoinUsername(e.target.value)} placeholder="Enter your name" />
                </div>
                <div>
                  <label style={labelStyle}>Session code</label>
                  <input style={inputStyle} value={joinId} onChange={e => setJoinId(e.target.value)} placeholder="Paste the code you were sent" />
                </div>
                <div>
                  <label style={labelStyle}>Password</label>
                  <input style={inputStyle} type="password" value={joinPwd} onChange={e => setJoinPwd(e.target.value)} />
                </div>
                <button style={btnStyle(true)} onClick={handleJoin}>{isLoading ? 'Asking…' : 'Ask to join'}</button>
                <button style={backBtnStyle} onClick={() => setPanel(null)}>← Back</button>
              </div>
            )}

            {/* Waiting at the door. Deliberately says nothing about the session
                — not its name, not its size — because none of that has been
                granted yet and showing it would imply otherwise. */}
            {panel === 'join' && waiting && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 0' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '9px',
                  fontFamily: 'var(--font-header)', fontSize: '0.86rem', fontWeight: 800,
                  letterSpacing: '-0.02em', color: '#FFFFFF',
                }}>
                  <span className="loading-spinner" style={{ width: '11px', height: '11px', flexShrink: 0 }} />
                  Waiting to be let in
                </div>
                <div style={{
                  fontFamily: 'var(--font-body)', fontSize: '0.62rem',
                  lineHeight: 1.6, color: 'var(--t4)',
                }}>
                  {joinUsername || 'You'} knocked. The session owner has to admit
                  you before anything is shared.
                </div>
                <button
                  style={backBtnStyle}
                  onClick={async () => {
                    const w = waiting;
                    setWaiting(null);
                    resetOrigin();
                    try { await cancelKnock(w.sessionId, w.requestId); } catch { /* the request expires on its own */ }
                  }}
                >
                  ✕ Stop waiting
                </button>
              </div>
            )}
          </div>
        )}


        {errorMsg && (
          <div style={{
            color: 'var(--crimson)',
            fontSize: '0.66rem',
            margin: '10px 14px',
            padding: '9px 12px',
            background: 'var(--crimson-dim)',
            border: '1px solid rgba(229,72,77,0.4)',
            borderRadius: '6px',
            fontFamily: 'var(--font-body)',
            fontWeight: 500,
            lineHeight: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            boxShadow: '0 4px 12px rgba(229, 72, 77, 0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '0.75rem', flexShrink: 0 }}>⚠</span>
              <span style={{ wordBreak: 'break-word' }}>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg('')}
              title="Dismiss notification"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--crimson)',
                cursor: 'pointer',
                padding: '2px 4px',
                fontSize: '0.7rem',
                fontWeight: 700,
                opacity: 0.8,
                borderRadius: '3px',
                lineHeight: 1,
                flexShrink: 0
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(229, 72, 77, 0.15)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = 'transparent'; }}
            >
              ✕
            </button>
          </div>
        )}

        {(sessionId || Object.keys(files).length > 0 || newItem) && (
          <div style={{ padding: '8px 0' }}>
            {/* The tree's whole look lives here rather than in per-row inline
                styles. Two reasons: hover and selection then cost nothing at
                runtime — no state, no re-render, just a class — and every row
                is guaranteed to agree about its own metrics, which is what
                keeps the guide lines under the icons at any depth. */}
            <style>{`
              /* ── The row ──
                 Full-bleed on purpose: no side margin and no radius, so the
                 selected row reads as a bar across the panel instead of a
                 floating pill that stops short of both edges. */
              .fx-file-item {
                position: relative;
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 28px;
                padding-right: 8px;
                cursor: pointer;
                user-select: none;
                color: var(--t2);
                transition: background 0.1s ease, color 0.1s ease;
              }
              .fx-file-item:hover { background: rgba(255, 255, 255, 0.045); color: var(--t1); }

              /* Selection. The theme spends its colour on file-type icons and
                 on git state, so the selected row asserts itself with contrast
                 instead of hue — a lifted ground, a hard white rail, and the
                 name at full white. Borrowing an accent colour here would put
                 a second loud thing next to the icons and lose to them. */
              .fx-file-item.is-active { background: rgba(255, 255, 255, 0.10); color: #FFFFFF; }
              .fx-file-item.is-active::before {
                content: '';
                position: absolute;
                left: 0; top: 0; bottom: 0;
                width: 2px;
                background: #FFFFFF;
              }
              .fx-file-item.is-active:hover { background: rgba(255, 255, 255, 0.13); }

              /* ── Indent guides ── one per ancestor level, full row height so
                 consecutive rows join into one unbroken rule. */
              .fx-guide {
                position: absolute;
                top: 0; bottom: 0;
                width: 1px;
                background: rgba(255, 255, 255, 0.07);
                pointer-events: none;
              }
              /* The selected row's ground would otherwise be sliced by them. */
              .fx-file-item.is-active .fx-guide { background: rgba(255, 255, 255, 0.10); }

              /* ── Chevron ── its column is held open for files too, so every
                 icon in the tree sits on the same vertical line. */
              .fx-chev, .fx-chev-gap {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 14px;
                flex-shrink: 0;
              }
              .fx-chev {
                color: var(--t4);
                transition: transform 0.15s ease, color 0.1s ease;
              }
              .fx-chev.is-open { transform: rotate(90deg); }
              .fx-file-item:hover .fx-chev, .fx-file-item.is-active .fx-chev { color: var(--t1); }

              /* ── Name ── */
              .fx-row-main {
                flex: 1;
                display: flex;
                align-items: center;
                gap: 9px;
                overflow: hidden;
              }
              .fx-row-name {
                font-family: var(--font-code);
                font-size: 0.8rem;
                font-weight: 500;
                letter-spacing: 0.005em;
                color: inherit;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
              .fx-file-item.is-active .fx-row-name { font-weight: 700; }

              /* ── Row actions ── revealed on hover, and kept out of the
                 pointer's way until then so they cannot be clicked blind. */
              .fx-file-del { opacity: 0; pointer-events: none; transition: opacity 0.12s ease; }
              .fx-file-item:hover .fx-file-del { opacity: 1; pointer-events: auto; }

              @media (prefers-reduced-motion: reduce) {
                .fx-file-item, .fx-chev { transition: none; }
              }
            `}</style>
            <div style={{ padding: '8px 14px', ...sectionLabelSty, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              {/* The label yields first: it truncates so the actions keep their
                  full width instead of being pushed off the panel's edge. */}
              <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Project Files
              </span>
              {/* Creating and uploading are edit actions, so viewers do not get
                  them. Taking a copy of the project and viewing history are
                  read-only, and a viewer has every reason to want both. */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--s0)',
                border: '1px solid var(--line-strong)',
                borderRadius: '6px',
                overflow: 'hidden',
                flexShrink: 0
              }}>
                {(!sessionId || canEdit) && (
                  <>
                    <ActionButton onClick={() => startNewFile()} title="New file (smart placement inside folder or root)">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
                    </ActionButton>
                    <div style={{ width: '1px', height: '14px', background: 'var(--line)' }} />
                    <ActionButton onClick={() => startNewFolder()} title="New folder (smart placement inside folder or root)">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
                    </ActionButton>

                    <div style={{ width: '1px', height: '14px', background: 'var(--line)' }} />
                    <ActionButton onClick={() => openProjectFolder()} title="Upload Folder">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    </ActionButton>
                    <div style={{ width: '1px', height: '14px', background: 'var(--line)' }} />
                  </>
                )}

                {/* Take a copy of the shared project onto this machine — the
                    project may exist nowhere locally. Mirrors the upload arrow. */}
                {sessionId && (
                  <>
                    <ActionButton
                      onClick={handleSaveProjectLocally}
                      title={canOpenLocalFolder
                        ? 'Save this project to a folder on your computer'
                        : 'Download this project as a .zip'}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    </ActionButton>
                    <div style={{ width: '1px', height: '14px', background: 'var(--line)' }} />
                  </>
                )}

                {/* Collapse everything. A deep project auto-expands on load,
                    which is right the first time and in the way every time
                    after — this is the one control that gets the whole tree
                    back to a page you can read. Toggles, so the same button
                    puts it back the way it was. */}
                {Object.keys(files).length > 0 && (
                  <>
                    <ActionButton
                      onClick={toggleCollapseAll}
                      title={expandedPaths.size > 0 ? 'Collapse all folders' : 'Expand all folders'}
                    >
                      {expandedPaths.size > 0 ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                      )}
                    </ActionButton>
                    <div style={{ width: '1px', height: '14px', background: 'var(--line)' }} />
                  </>
                )}

                <ActionButton onClick={() => { setTerminalActiveTab('timeline'); setTerminalOpen(true); }} title="Session Timeline">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                </ActionButton>
              </div>
            </div>

            {/* The one thing an owner has to hand out. It is the session id
                until the tunnel answers, then the same id with the host
                address folded in — so there is never a second field to copy
                and never a second instruction to give.

                Shown only while nobody else has arrived. Once someone has,
                the invitation has served its purpose and the code is still
                in the header beside RUN — leaving this here would keep a
                permanent panel of setup instructions above the file tree. */}
            {sessionId && joinCode && (connectedUsers.length <= 1 || joinCodeStale) && (
              <ShareStrip
                code={joinCode}
                state={tunnelState}
                error={tunnelError}
                stale={joinCodeStale}
                onDismissStale={() => useEditorStore.getState().setJoinCodeStale(false)}
              />
            )}

            {newItem && newItem.parent === '' && (
              <NewItemForm isInline={false} />
            )}
            {Object.keys(files).length === 0 ? (
              userRole === 'owner' ? (
                <div style={{
                  padding: '24px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: '12px'
                }}>
                  {/* Classy empty drop-zone layout */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '12px'
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div style={{
                        fontFamily: 'var(--font-header)',
                        fontSize: '0.76rem',
                        fontWeight: 900,
                        color: '#FFFFFF',
                        letterSpacing: '-0.02em',
                        textTransform: 'uppercase'
                      }}>
                        Awaiting Project
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: '0.62rem',
                        color: 'var(--t4)',
                        lineHeight: 1.4
                      }}>
                        {canOpenLocalFolder
                          ? 'Open a folder to edit it in place. Your files stay on your disk — no session needed.'
                          : 'Upload a directory or select files to initialize the workspace.'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                    {/* Opens the folder in place: edits are written straight back to
                        disk, so they show up in any other editor and nothing is
                        copied into the database. Desktop app only. */}
                    {canOpenLocalFolder && (
                      <button
                        style={{
                          background: '#FFFFFF',
                          border: 'none',
                          borderRadius: '3px',
                          color: '#000000',
                          fontFamily: 'var(--font-header)',
                          fontSize: '0.62rem',
                          fontWeight: 900,
                          padding: '10px 14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          letterSpacing: '0.04em',
                          transition: 'transform 0.1s ease, background 0.15s ease'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#EDEDED'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#FFFFFF'; }}
                        onClick={handleOpenLocalFolder}
                        title="Edit files directly on your disk — no session, changes visible to other editors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          <path d="M12 11v6M9 14h6" />
                        </svg>
                        OPEN FOLDER
                      </button>
                    )}
                    {/* Browser fallback only. On the desktop, OPEN FOLDER above
                        covers this — and copying a project into a session is now
                        something you opt into via New Session, not a way to open
                        a folder. */}
                    {!canOpenLocalFolder && (
                      <button
                        style={{
                          background: '#FFFFFF',
                          border: 'none',
                          borderRadius: '3px',
                          color: '#000000',
                          fontFamily: 'var(--font-header)',
                          fontSize: '0.62rem',
                          fontWeight: 900,
                          padding: '10px 14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          letterSpacing: '0.04em',
                          transition: 'transform 0.1s ease, background 0.15s ease'
                        }}
                        onClick={() => openProjectFolder()}
                        title="Upload the folder into a workspace"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        IMPORT FOLDER
                      </button>
                    )}
                    {/* Loose files have no project root to be saved back into, so
                        on the desktop they would only be storable in a session —
                        which is exactly what we no longer create implicitly. Open
                        a folder instead. */}
                    {!canOpenLocalFolder && (
                      <button
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--line-strong)',
                          borderRadius: '3px',
                          color: 'var(--t2)',
                          fontFamily: 'var(--font-number)',
                          fontSize: '0.58rem',
                          fontWeight: 900,
                          padding: '9px 14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          letterSpacing: '0.06em',
                          transition: 'color 0.15s ease, border-color 0.15s ease'
                        }}
                        onClick={() => fileInputRef.current?.click()}
                        onMouseEnter={e => { e.currentTarget.style.color = '#FFFFFF'; e.currentTarget.style.borderColor = '#FFFFFF'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--t2)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                          <polyline points="13 2 13 9 20 9" />
                        </svg>
                        SELECT FILES
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: '36px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  textAlign: 'center'
                }}>
                  <span className="loading-spinner" style={{ width: '14px', height: '14px', borderColor: 'var(--cyan) transparent' }} />
                  <div style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: '0.64rem',
                    color: 'var(--t3)',
                    lineHeight: 1.5,
                    maxWidth: '180px'
                  }}>
                    Waiting for the session owner to upload files…
                  </div>
                </div>
              )
            ) : (
              renderTree(tree)
            )}
            
            {/* Flat Integrated Session Panel */}
            <div style={{
              margin: '24px 14px 12px',
              borderTop: '1px solid var(--line-faint)',
              paddingTop: '16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '4px'
            }}>
              <div
                title={workspaceRoot ? (workspaceName || 'Local Folder') : (sessionName || 'Local Session')}
                style={{
                  fontFamily: 'var(--font-header)',
                  fontSize: '0.9rem',
                  fontWeight: 900,
                  color: '#FFFFFF',
                  letterSpacing: '-0.02em',
                  textTransform: 'uppercase',
                  lineHeight: 1.2,
                  /* Wrap at spaces first and only split a word when it genuinely
                     cannot fit. `break-all` split on whatever character happened
                     to land at the edge, which is what turned "LOCAL SESSION"
                     into "LOCAL SESSIO / N" in a narrow sidebar. */
                  wordBreak: 'normal',
                  overflowWrap: 'anywhere',
                  width: '100%'
                }}
              >
                {workspaceRoot ? (workspaceName || 'Local Folder') : (sessionName || 'Local Session')}
              </div>

              {/* Where the files actually live, so it's never ambiguous whether
                  edits are hitting the disk or a session. */}
              {workspaceRoot && (
                <div
                  title={workspaceRoot}
                  style={{
                    fontFamily: 'var(--font-number)',
                    fontSize: '0.5rem',
                    color: 'var(--t4)',
                    letterSpacing: '0.04em',
                    wordBreak: 'break-all',
                    width: '100%',
                    marginBottom: '2px'
                  }}
                >
                  {workspaceRoot}
                </div>
              )}

              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontFamily: 'var(--font-number)',
                fontSize: '0.52rem',
                fontWeight: 900,
                color: '#000000',
                background: '#FFFFFF',
                padding: '2px 8px',
                borderRadius: '3px',
                letterSpacing: '0.08em',
                marginTop: '6px'
              }}>
                <span style={{
                  width: '4px',
                  height: '4px',
                  borderRadius: '50%',
                  background: '#000000'
                }} />
                {workspaceRoot ? 'ON DISK' : userRole === 'owner' ? 'OWNER' : 'COLLAB'}
              </div>

              {/* Under the badge because that is where someone looks to answer
                  "what am I in?" — and the next question is always "how does
                  anyone else get in?". A joiner can pass it on as well as a
                  host, so this is not owner-only. */}
              {sessionId && (
                <button
                  onClick={copyJoinCode}
                  title={codeCopied ? 'Copied' : `Copy the invitation — ${joinCode || sessionId}`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: codeCopied ? '#FFFFFF' : 'var(--t3)',
                    fontFamily: 'var(--font-number)',
                    fontSize: '0.56rem',
                    fontWeight: 900,
                    letterSpacing: '0.08em',
                    cursor: 'pointer',
                    marginTop: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'color 0.15s ease'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#FFFFFF'; }}
                  onMouseLeave={e => {
                    e.currentTarget.style.color = codeCopied ? '#FFFFFF' : 'var(--t3)';
                  }}
                >
                  {codeCopied ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                    </svg>
                  )}
                  <span style={{ textDecoration: 'underline' }}>
                    {codeCopied ? 'COPIED' : 'COPY SESSION CODE'}
                  </span>
                </button>
              )}

              <button
                onClick={handleDisconnect}
                title={sessionId
                  ? 'Leave this session (your files stay on disk)'
                  : 'Close this folder (your files stay on disk)'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  color: 'var(--t3)',
                  fontFamily: 'var(--font-number)',
                  fontSize: '0.56rem',
                  fontWeight: 900,
                  letterSpacing: '0.08em',
                  cursor: 'pointer',
                  /* Tight to the copy control above it — the two are one stack
                     of session actions. Without it, the 16px that separated
                     this from the badge became a gap in the middle of a list. */
                  marginTop: sessionId ? '7px' : '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'color 0.15s ease'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = '#FFFFFF';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--t3)';
                }}
              >
                <span>✕</span>
                <span style={{ textDecoration: 'underline' }}>
                  {sessionId ? 'LEAVE SESSION' : 'CLOSE FOLDER'}
                </span>
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default FileExplorer;
