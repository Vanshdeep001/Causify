/* -------------------------------------------------------
 * App.jsx — DebugSync Application Shell
 * ------------------------------------------------------- */

import React, { useEffect, useRef, useState } from 'react';
import EditorPage from './pages/EditorPage';
import UserPresence from './components/Session/UserPresence';
import VoiceRoom from './components/Session/VoiceRoom';
import NotificationSystem from './components/Session/NotificationSystem';
import ScreenCapture from './components/Capture/ScreenCapture';
import CodeShotModal from './components/CodeShot/CodeShotModal';
import { parseCodeShotLink } from './utils/codeShotDeepLink';
import useEditorStore from './store/useEditorStore';
import { connectWebSocket, disconnectWebSocket } from './services/socket';
import { buildCollabCallbacks, reconnectOnConnected } from './services/collabCallbacks';
import { saveFile, getSession, touchSession, leaveSession } from './services/api';
import { setOrigin, resetOrigin, buildJoinCode, clearSessionToken, getSessionToken, isRemoteHost } from './services/backendHost';
import { publishSession } from './services/rendezvous';
import MigrateWorkspaceModal from './components/Editor/MigrateWorkspaceModal';
import causifyLogo from './assets/causify-mark.png';

// Module-level so React StrictMode's double-mount can't run the bootstrap twice
let sessionRehydrateAttempted = false;

const App = () => {
  const sessionId = useEditorStore((s) => s.sessionId);
  const sessionName = useEditorStore((s) => s.sessionName);
  const currentUser = useEditorStore((s) => s.currentUser);
  const toggleTerminal = useEditorStore((s) => s.toggleTerminal);
  const setTerminalActiveTab = useEditorStore((s) => s.setTerminalActiveTab);
  const followToast = useEditorStore((s) => s.followToast);
  const reconnectedRef = useRef(false);
  // Gate the WebSocket reconnect until the session-bootstrap below has decided
  // the final sessionId (verified-existing vs freshly-recreated), so we never
  // connect to a stale id.
  const [bootstrapDone, setBootstrapDone] = useState(false);

  // Set when launch finds a workspace whose files live only inside the app —
  // { fileCount, name } — which prompts the one-time move to a real folder.
  const [legacyWorkspace, setLegacyWorkspace] = useState(null);

  /**
   * Move a pre-local-mode workspace onto disk.
   *
   * The files are read from the store rather than the backend: that copy is
   * always present, needs no network, and is the one the user has been looking
   * at. Once they are safely written, the old session is deleted so the same
   * project is not left duplicated in the database.
   *
   * Returns false if the user backed out of the folder picker.
   */
  const migrateLegacyWorkspace = async () => {
    const store = useEditorStore.getState();
    const entries = Object.entries(store.files || {});
    if (entries.length === 0) { setLegacyWorkspace(null); return true; }

    const placed = await window.electronAPI.workspace.materialize(Object.fromEntries(entries));
    if (!placed) return false; // cancelled — keep the prompt up

    store.openLocalWorkspace(placed);

    // The files are on disk now, so the session copy is redundant.
    const oldSessionId = store.sessionId;
    if (oldSessionId) {
      try {
        await leaveSession(oldSessionId, store.currentUser?.id);
      } catch (err) {
        console.warn('[Causify] Could not release the old session:', err.message);
      }
      useEditorStore.getState().resetSession();
    }

    console.log(`[Causify] Moved ${placed.written} file(s) to ${placed.root}`);
    setLegacyWorkspace(null);
    return true;
  };

  // ── Bootstrap on launch ──
  //
  // Two independent responsibilities, run in this order:
  //
  //   1. THE FILES. A folder opened from disk is re-read, so anything added,
  //      removed or edited outside Causify is picked up. Nothing else in this
  //      function may replace what that read produced.
  //   2. THE SESSION. A persisted session is verified and marked as in use, or
  //      cleared if the backend no longer has it.
  //
  // These used to be one branch: opening a folder returned before the session
  // was ever looked at. That had two consequences, both wrong. The session was
  // never touched, so its retention clock kept running while the user was
  // demonstrably still working in it — and a session that had already been
  // swept stayed in localStorage, so the app reconnected to a room that no
  // longer existed. Having a folder open says nothing about whether the
  // session behind it is still alive, so the two are decided separately now.
  //
  // Causify still never mints a session on its own; that only happens when the
  // user starts or joins one.
  useEffect(() => {
    // StrictMode remount (or a prior mount) already ran the bootstrap — just
    // release the reconnect gate so it isn't left waiting forever.
    if (sessionRehydrateAttempted) { setBootstrapDone(true); return; }
    sessionRehydrateAttempted = true;

    (async () => {
      try {
        const store = useEditorStore.getState();

        /* ── 1. The folder ── */
        let hasWorkspace = false;
        if (store.workspaceRoot && window.electronAPI?.workspace) {
          try {
            const restored = await window.electronAPI.workspace.reopen(store.workspaceRoot);
            if (restored) {
              store.openLocalWorkspace(restored);
              hasWorkspace = true;
              console.log('[Causify] Reopened local workspace:', restored.root);
            } else {
              console.warn('[Causify] Previously opened folder is gone — clearing it.');
              store.closeLocalWorkspace();
            }
          } catch (err) {
            /* A folder that is configured but momentarily unreadable — a locked
               drive, a network share still mounting — is still the project. It
               must keep its authority over the session copy, or a transient
               read error would hand the database the right to overwrite it. */
            console.warn('[Causify] Could not reopen the local workspace:', err.message);
            hasWorkspace = Boolean(useEditorStore.getState().workspaceRoot);
          }
        }

        /* ── 2. The session ──
         *
         * Runs whether or not a folder is open. Touching is what keeps the
         * retention sweep off a session someone is still using, and it is
         * deliberately not coupled to loading files: those are two different
         * questions and only one of them has an answer that depends on mode. */
        const { sessionId: storedId, currentUser: storedUser } = useEditorStore.getState();
        let sessionAlive = false;
        let sessionGone = false;

        if (storedId && storedUser) {
          try {
            const data = await getSession(storedId);
            if (data && (data.id || data.sessionId)) {
              sessionAlive = true;
              touchSession(storedId).catch(() => { /* best effort */ });
            } else {
              sessionGone = true;
            }
          } catch (err) {
            /* Only a real 404 means the session is gone. A timeout or a refused
             * connection means the HOST is unreachable — their laptop is shut,
             * the tunnel is between addresses — and the session may well still
             * be there when they come back. Discarding it on a network blink
             * would log the user out of a session that never ended. */
            if (err.response?.status === 404) {
              sessionGone = true;
            } else {
              console.warn('[Causify] Could not reach the session host — keeping the stored session:', err.message);
            }
          }
        }

        /* ── 3. Files that exist only inside the app ──
         *
         * Decided before the dead session is cleared, because clearing it also
         * clears those files when there is no folder holding them. Offering the
         * move first is what keeps a pre-local-mode workspace recoverable.
         *
         * migrateLegacyWorkspace releases the session itself once the files are
         * safely on disk, so the clear below is skipped in this one case. */
        const strandedFiles = hasWorkspace
          ? 0
          : Object.keys(useEditorStore.getState().files || {}).length;
        const offeringMigration = !sessionAlive
          && strandedFiles > 0
          && Boolean(window.electronAPI?.workspace);

        if (offeringMigration) {
          setLegacyWorkspace({
            fileCount: strandedFiles,
            name: useEditorStore.getState().sessionName,
          });
          return;
        }

        /* Files with nowhere else to live and no way to move them — a browser,
         * or a desktop build without the workspace bridge. resetSession would
         * empty `files` here, and localStorage is the only copy of them, so a
         * tidy-up would be a deletion. The stale id is by far the lesser evil:
         * it makes the app think it is in a session that has ended, which is
         * recoverable, and it stops nothing the user can still do locally. */
        if (sessionGone && strandedFiles > 0) {
          console.warn(
            `[Causify] Session is gone but ${strandedFiles} file(s) exist only in this app — keeping them.`
          );
          return;
        }

        /* ── 4. A session the backend no longer has ──
         *
         * Left in place, the id would sit in localStorage forever and the
         * reconnect below would open a socket to a room that was swept days
         * ago. Cleared the same way leaving a session clears it — token,
         * origin, then state.
         *
         * resetSession keeps a local workspace intact by design: the folder
         * belongs to the user, not to the session, so an expired session must
         * cost them the collaboration and nothing else. They can start or join
         * a new session from the same folder immediately. */
        if (sessionGone) {
          console.warn('[Causify] Stored session is no longer on the backend — clearing it.');
          clearSessionToken();
          resetOrigin();
          useEditorStore.getState().resetSession();
        }
      } catch (err) {
        console.warn('[Causify] Could not bootstrap:', err.message);
      } finally {
        setBootstrapDone(true);
      }
    })();
  }, []);

  // Mouse tracking state for cursor-following background glow
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handleMouseMove = (e) => {
      setCoords({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  /* ── The tunnel changed address ──
   *
   * A quick tunnel keeps its URL only until the next interruption: a Wi-Fi
   * drop, a wake from sleep, a Cloudflare edge rotation, a new IP from the
   * ISP. cloudflared then prints a fresh address and carries on, so the app
   * stays perfectly healthy while the link everyone was given goes dead.
   *
   * Nothing can be done about the old link — the only channel to the people
   * holding it was that link. What is possible is to notice immediately, point
   * this app at the new address, and put the new invite in front of the host
   * so re-sharing is a copy and a paste.
   */
  useEffect(() => {
    if (!window.electronAPI?.tunnel?.onUrlChanged) return;

    const unsubscribe = window.electronAPI.tunnel.onUrlChanged(({ url }) => {
      if (!url) return;
      const store = useEditorStore.getState();

      setOrigin(url);
      if (store.sessionId) {
        store.setJoinCode(buildJoinCode(store.sessionId, url));
        store.setJoinCodeStale(true);
        // The address on every invite already sent is now wrong, and this is
        // the only place that knows the right one. Republishing under the same
        // session id repairs those invites for anyone who looks the code up.
        publishSession(store.sessionId, url);
      }
      console.warn('[Causify] Tunnel address changed — the previous invite link is dead.');
    });

    return unsubscribe;
  }, []);

  /* Rewind used to sample on a 15s timer from here. It does not any more:
     checkpoints are saved when the owner decides to save one, so there is
     nothing for the app to do in the background. See captureCheckpoint. */

  // ── Deep-link navigation handler (Electron causify:// protocol) ──
  useEffect(() => {
    if (!window.electronAPI?.onCodeShotNavigate) return;

    const unsubscribe = window.electronAPI.onCodeShotNavigate((data) => {
      if (!data) return;
      console.log('[Causify] Deep-link navigation:', data);

      const store = useEditorStore.getState();

      // If a file path is provided, navigate to it
      if (data.filePath && store.files[data.filePath]) {
        store.openFile(data.filePath);

        // After a short delay for Monaco to mount, highlight the line range
        setTimeout(() => {
          const editor = document.querySelector('.monaco-editor');
          if (editor && window.monaco) {
            // Find the editor instance via Monaco's getEditors API
            const editors = window.monaco.editor.getEditors();
            if (editors.length > 0) {
              const ed = editors[0];
              const startLine = data.startLine || 1;
              const endLine = data.endLine || startLine;

              ed.revealLineInCenter(startLine);
              ed.setSelection(new window.monaco.Range(
                startLine, 1, endLine,
                ed.getModel()?.getLineMaxColumn(endLine) || 1
              ));
              ed.focus();
            }
          }
        }, 300);
      }
    });

    return unsubscribe;
  }, []);

  // ── Auto-reconnect WebSocket after refresh / reopen ──
  // Waits for the bootstrap above to settle the final sessionId, so we connect
  // to the verified (or freshly recreated) session, never a stale id.
  useEffect(() => {
    if (!bootstrapDone) return;
    if (reconnectedRef.current) return;
    if (!sessionId || !currentUser) return;

    reconnectedRef.current = true;
    console.log('[Causify] Reconnecting to session:', sessionId);

    // Reconnect WebSocket. Same handler set the create/join path uses — see
    // collabCallbacks.js for why these two must not be spelled out separately.
    connectWebSocket(sessionId, currentUser, buildCollabCallbacks({
      sessionId,
      onConnected: reconnectOnConnected(sessionId),
    }));

    /* ── Half a session ──
     *
     * The session id survives a reopen (localStorage) but the membership token
     * does not (sessionStorage, deliberately — it is a credential and windows
     * are where credentials end). For the host that costs nothing: the guard
     * only demands a token from requests arriving off-machine, and theirs are
     * local.
     *
     * A collaborator reconnecting through the tunnel is the broken case. The
     * socket comes up, presence works, editing works — and then Run, the dev
     * server, git and the agent all fail, because those are exactly the
     * endpoints that ask for proof of membership. Nothing on screen explains
     * why, which makes it read as the feature being broken.
     *
     * Detected here and said out loud instead. The way back is the join flow
     * they already know, replayed for the session they are already in; the
     * token is only reissued by the server, and only to someone who can still
     * produce the password.
     */
    if (useEditorStore.getState().userRole === 'collaborator'
        && isRemoteHost()
        && !getSessionToken()) {
      console.warn('[Causify] Reconnected without a session token — full access needs the password again.');
      useEditorStore.getState().setReauthNeeded(true);
    }
  }, [bootstrapDone, sessionId, currentUser]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl + S -> Save current file
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const state = useEditorStore.getState();
        if (!state.activePath) return;

        // Local mode writes to the real file; otherwise persist to the session
        // as before.
        if (state.workspaceRoot) {
          state.writeLocalFile(state.activePath, state.code)
            .then(() => console.log('[Causify] Saved to disk:', state.activePath))
            .catch((err) => console.error('[Causify] Disk save failed:', err));
        } else if (state.sessionId) {
          saveFile(state.sessionId, state.activePath, state.code)
            .then(() => console.log('[Causify] File saved:', state.activePath))
            .catch((err) => console.error('[Causify] Save failed:', err));
        }
      }
      // Ctrl + ` (backtick) -> Toggle Terminal
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        toggleTerminal();
      }
      // Ctrl + 1 -> Output
      if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        setTerminalActiveTab('output');
      }
      // Ctrl + 2 -> Timeline
      if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        setTerminalActiveTab('timeline');
      }
      // Ctrl + 3 -> Graph
      if (e.ctrlKey && e.key === '3') {
        e.preventDefault();
        setTerminalActiveTab('graph');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      disconnectWebSocket();
    };
  }, [toggleTerminal, setTerminalActiveTab]);

  return (
    <div className="app-container" style={{
      '--mouse-x': `${coords.x}px`,
      '--mouse-y': `${coords.y}px`
    }}>
      {/* Canvas: blueprint grid, barely visible */}
      <div className="cockpit-env">
        <div className="cockpit-grid" />
        <div className="cursor-glow" />
      </div>

      {/* ── Top navigation — premium OS toolbar ── */}
      <header className="app-header" style={{
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(17, 17, 17, 0.65)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '48px',
        position: 'relative',
        zIndex: 10
      }}>
        {/* Left: brand + project */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <img src={causifyLogo} alt="Causify Logo" style={{ height: '24px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <div style={{ width: '1px', height: '18px', background: 'var(--line-strong)' }} />
          <span style={{
            fontFamily: 'var(--font-header)',
            fontSize: '0.64rem',
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--lime)',
            background: 'var(--lime-dim)',
            border: '1px solid var(--lime-line)',
            borderRadius: '4px',
            padding: '3px 8px',
          }}>
            {sessionName || 'CORE'}
          </span>
          {sessionId && (
            <span style={{
              fontFamily: 'var(--font-number)', fontSize: '0.58rem',
              color: 'var(--t3)', background: 'var(--s3)',
              border: '1px solid var(--line)', borderRadius: '4px',
              padding: '2px 8px', letterSpacing: '0.04em',
            }}>
              {sessionId.substring(0, 8)}
            </span>
          )}

          {/* Screen recording. Up here rather than in the editor toolbar
              because what it captures is the window, not the file you happen to
              have open — beside RUN it read as another action you perform on
              your code. The divider keeps it out of the identity block: the
              logo, the project and the session id say what this is; this is the
              first thing you can do to it.

              Its own flex group with a tighter gap, because the button is a
              28px box around a 15px icon — it carries about 6px of padding of
              its own. Inheriting the row's 12px would put ~18px of air between
              the divider and the icon against 12px on the other side, which is
              what made it look adrift rather than attached to the rule. */}
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '1px', height: '18px', background: 'var(--line-strong)' }} />
            <ScreenCapture />
          </span>
        </div>

        {/* Right: collaboration + session status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', height: '100%' }}>
          {sessionId && <VoiceRoom />}
          {sessionId && <UserPresence />}
        </div>
      </header>

      <main className="app-main" style={{ position: 'relative', zIndex: 5 }}>
        <EditorPage />
      </main>

      <NotificationSystem />
      <CodeShotModal />

      {/* One-time prompt to move a pre-local-mode workspace onto disk. */}
      {legacyWorkspace && (
        <MigrateWorkspaceModal
          fileCount={legacyWorkspace.fileCount}
          workspaceName={legacyWorkspace.name}
          onMigrate={migrateLegacyWorkspace}
          onSkip={() => setLegacyWorkspace(null)}
        />
      )}

      {/* Follow mode toast */}
      {followToast && (
        <div className="follow-toast">
          {followToast}
        </div>
      )}
    </div>
  );
};

export default App;
