/* -------------------------------------------------------
 * collabCallbacks.js — what a client does with every message
 * the session broadcasts.
 *
 * There are two ways into a live session: creating or joining one
 * (FileExplorer), and reconnecting to one after a refresh or reopen (App).
 * Each used to spell out its own callback set by hand, and the two drifted —
 * the create/join path never registered onFollowUpdate, onVoiceSignal,
 * onUserKicked or onDisconnected. The subscriptions were live and the messages
 * arrived; nothing was listening. Follow mode, voice signalling and kicks
 * therefore worked only for people who happened to have refreshed the page.
 *
 * Both paths build their callbacks here now, so a handler added for one entry
 * point is a handler both entry points get.
 * ------------------------------------------------------- */

import useEditorStore from '../store/useEditorStore';
import { getSessionFiles, uploadProject } from './api';
import { disconnectWebSocket } from './socket';

/* Sessions whose server copy has already been refreshed from disk this launch.
 * The STOMP client calls onConnect again on every automatic reconnect, and a
 * Wi-Fi blink is not a reason to re-read and re-upload an entire project. */
let diskPushedFor = null;

/**
 * Bring the session's copy of the project up to date with the folder on disk.
 *
 * Only the owner, and only in folder mode. In that combination the disk is the
 * project and `project_files` is a transport copy that was last written
 * whenever this session last ran — so after a relaunch it can be behind by
 * everything the user did in another editor in between.
 *
 * That copy is not dead weight: it is what a NEW collaborator is handed when
 * they join. Left stale, the first fix here would only move the problem — the
 * host would see their real files while anyone joining received the old ones.
 *
 * Strictly one direction. The disk is read and pushed up; nothing comes back.
 * A collaborator never does this, because their folder is a copy of the
 * session rather than the source of it.
 *
 * Deliberately silent: no project-sync broadcast. The people already in the
 * room are in sync through the CRDT, and telling them to re-read the database
 * would make them overwrite their own disk-backed state with it.
 */
const refreshSessionCopyFromDisk = async (sessionId) => {
  const { workspaceRoot, userRole } = useEditorStore.getState();
  const workspace = typeof window !== 'undefined' ? window.electronAPI?.workspace : null;

  if (userRole !== 'owner') return;
  if (!workspaceRoot || !workspace?.readAll) return;
  if (diskPushedFor === sessionId) return;
  diskPushedFor = sessionId;

  try {
    const contents = await workspace.readAll(workspaceRoot);
    const files = Object.entries(contents).map(([path, content]) => ({ path, content }));
    // An empty read is far more likely to be a failed walk than a genuinely
    // empty project, and uploading it would clear the session's only copy.
    if (files.length === 0) return;

    await uploadProject(sessionId, files);
    console.log(`[Causify] Session copy brought up to date from disk (${files.length} files).`);
  } catch (err) {
    /* Best effort. Failing here costs a joiner an up-to-date first copy; it
       must never stop the owner's own reconnect. */
    diskPushedFor = null; // let the next reconnect try again
    console.warn('[Causify] Could not refresh the session copy from disk:', err.message);
  }
};

/**
 * @param {Object}   opts
 * @param {string}   opts.sessionId   - Session being connected to
 * @param {Function} opts.onConnected - Runs once the socket is up. The two
 *   entry paths differ here: joining already has the files, reconnecting has
 *   to re-fetch them.
 * @returns {Object} Callback set for connectWebSocket
 */
export const buildCollabCallbacks = ({ sessionId, onConnected }) => ({
  onCodeChange: (d) => {
    const currentU = useEditorStore.getState().currentUser;
    const isOwnChange = d.userId === currentU?.id;
    useEditorStore.getState().updateRemoteFile(d.path, d.code, isOwnChange ? null : d.userId);
  },

  onUsersChange: (d) => useEditorStore.getState().setConnectedUsers(d.users || []),

  /* The whole map every time, never a delta — a client that missed a message
     is corrected by the next one instead of holding a stale lock forever. */
  onLocksChange: (d) => useEditorStore.getState().setLockedFiles(d.locks || {}),

  onAdmissionChange: (d) => useEditorStore.getState().setPendingAdmissions(d.pending || []),

  /* The owner saved a checkpoint. The sender already captured its own before
     publishing, so it must not do so twice. */
  onCheckpoint: (d) => {
    const me = useEditorStore.getState().currentUser;
    if (d?.by?.id && me?.id && d.by.id === me.id) return;
    useEditorStore.getState().applyRemoteCheckpoint(d);
  },

  onExecutionResult: (d) => useEditorStore.getState().handleExecutionResult(d),

  onSnapshot: (d) => useEditorStore.getState().addSnapshot(d),

  onCursorUpdate: (d) => {
    const currentU = useEditorStore.getState().currentUser;
    if (d.userId === currentU?.id) return;
    if (d.onWhiteboard) {
      if (window.onWhiteboardCursorMessage) window.onWhiteboardCursorMessage(d);
    } else {
      useEditorStore.getState().updateRemoteCursor(d.userId, d);
    }
  },

  onPresenceUpdate: (d) => {
    const currentU = useEditorStore.getState().currentUser;
    if (d.userId !== currentU?.id) useEditorStore.getState().updateFilePresence(d.userId, d);
  },

  onFileDelete: (d) => {
    const currentU = useEditorStore.getState().currentUser;
    if (d.userId !== currentU?.id) useEditorStore.getState().removeFile(d.path);
  },

  // A peer uploaded a project into the session. The files arrived over REST,
  // so there are no per-file events to apply — re-read the list instead.
  onProjectSync: async (d) => {
    const state = useEditorStore.getState();
    if (d?.userId === state.currentUser?.id) return; // our own upload
    if (!state.sessionId) return;
    try {
      const files = await getSessionFiles(state.sessionId);
      useEditorStore.getState().mergeRemoteFiles(files);
    } catch (err) {
      console.warn('[Causify] Could not load the shared project:', err.message);
    }
  },

  onWhiteboardChange: (d) => {
    if (window.onWhiteboardSocketMessage) window.onWhiteboardSocketMessage(d);
  },

  onRevert: (d) => {
    const currentU = useEditorStore.getState().currentUser;
    if (d.revertedUser === currentU?.username || d.revertedUser === currentU?.id) {
      useEditorStore.getState().setRevertNotification({
        username: d.username,
        path: d.path,
        reason: 'cross-file impact',
      });
    }
  },

  onVoiceSignal: (d) => {
    // Route to VoiceRoom component via global handler
    if (window._onVoiceSignal) window._onVoiceSignal(d);
  },

  onUserKicked: (d) => {
    const currentU = useEditorStore.getState().currentUser;
    if (d.userId !== currentU?.id) return;
    alert('You have been removed from the session by the owner.');
    useEditorStore.getState().resetGit();
    useEditorStore.setState({
      sessionId: null,
      sessionName: '',
      currentUser: null,
      userRole: null,
      connectedUsers: [],
    });
    disconnectWebSocket();
    window.location.reload();
  },

  /* Follow mode. Three messages share one topic:
   *  - follow-start/stop tell a leader who is watching them, which is what
   *    gates their editor-state broadcast. Miss these and the leader never
   *    sends anything, so the follower's screen sits still while their badge
   *    insists it is following.
   *  - follow-state carries the leader's file/scroll/cursor to the follower. */
  onFollowUpdate: (d) => {
    const store = useEditorStore.getState();
    const currentU = store.currentUser;
    if (!currentU) return;

    if (d.type === 'follow-start') {
      if (d.leaderId === currentU.id) {
        store.addFollower(d.followerId);
        const followerUser = store.connectedUsers.find((u) => u.id === d.followerId);
        store.setFollowToast(`${followerUser?.username || 'Someone'} is now following you`);
      }
    } else if (d.type === 'follow-stop') {
      if (d.leaderId === currentU.id) {
        store.removeFollower(d.followerId);
      }
      // If we were following them and they stopped (shouldn't happen, but guard)
      if (d.followerId === currentU.id) {
        store.stopFollowing();
      }
    } else if (d.type === 'follow-state') {
      // Only act on the leader we actually asked to follow.
      if (store.followingUserId === d.leaderId) {
        store.setFollowState(d);
      }
    }
  },

  /* Health is tracked here rather than at each call site so every path that
     builds these callbacks gets it — including the reconnect path, which
     supplies its own onConnected. */
  onConnected: () => {
    useEditorStore.getState().markSocketConnected();
    if (onConnected) onConnected();
    else useEditorStore.getState().loadSessionHistory(sessionId);
  },

  onDisconnected: () => {
    useEditorStore.getState().markSocketDropped();
  },
});

/**
 * The reconnect path's onConnected: the session outlived the page, so re-read
 * the files rather than trusting whatever was cached locally.
 *
 * ── Which copy is the truth ──
 *
 * "Cached locally" is only true in session-only mode, where the app's own copy
 * of the project is a snapshot from the last time the window was open and the
 * database holds the newer one. With a real folder open it is the other way
 * round: the disk is the project, it has just been re-read on launch, and the
 * `project_files` rows are the stale party — they were last written whenever
 * this session last synced, which may be days and one VS Code session ago.
 *
 * Overwriting the freshly-read folder with those rows is what made edits made
 * in another editor disappear on reopen. So the fetch below is skipped
 * entirely when a folder is open. Nothing else about the reconnect changes:
 * the socket, presence, locks, the CRDT and the history all still come up, and
 * collaborators' live edits still arrive and are still written to disk. The
 * only thing withheld is the database's opinion about what the files contain.
 */
export const reconnectOnConnected = (sessionId) => () => {
  console.log('[Causify] Reconnected to Collab');
  const currentState = useEditorStore.getState();
  currentState.loadSessionHistory(sessionId);

  /* Read fresh rather than from the snapshot above: the folder is reopened
     during bootstrap and this runs once the socket answers, so the two are
     ordered but not atomically. */
  if (useEditorStore.getState().workspaceRoot) {
    console.log('[Causify] Local folder is open — keeping the files on disk over the session copy.');
    // The traffic goes the other way instead: disk up to the session, so the
    // next person to join is handed what is actually in the folder.
    refreshSessionCopyFromDisk(sessionId);
    return;
  }

  getSessionFiles(sessionId).then((serverFiles) => {
    if (!serverFiles || serverFiles.length === 0) return;
    const fileMap = {};
    serverFiles.forEach((f) => { fileMap[f.path] = f.content; });
    // Merge: use server files as base, keeping local activePath
    useEditorStore.setState({
      files: fileMap,
      code: fileMap[currentState.activePath] || serverFiles[0].content || '',
      activePath: fileMap[currentState.activePath] ? currentState.activePath : serverFiles[0].path,
    });
  }).catch((err) => {
    // File fetch is best-effort — we already have files from localStorage.
    // The WebSocket connected successfully, so the session IS alive.
    console.warn('[Causify] Could not fetch files on reconnect, using cached files:', err.message);
  });
};
