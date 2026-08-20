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
import { getSessionFiles } from './api';
import { disconnectWebSocket } from './socket';

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
 */
export const reconnectOnConnected = (sessionId) => () => {
  console.log('[Causify] Reconnected to Collab');
  const currentState = useEditorStore.getState();
  currentState.loadSessionHistory(sessionId);

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
