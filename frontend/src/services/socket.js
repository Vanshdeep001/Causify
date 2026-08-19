/* -------------------------------------------------------
 * socket.js — WebSocket Client Service
 * 
 * Manages STOMP-over-WebSocket connection to the backend
 * for real-time collaboration features:
 *   - Code sync between users
 *   - User presence (join/leave)
 *   - Live execution results
 *   - Voice room signaling (WebRTC)
 *   - Follow mode editor state relay
 * ------------------------------------------------------- */

import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client/dist/sockjs';
import { initCollab, destroyCollab, handleYjsMessage } from './collabDoc';
import { getWsUrl } from './backendHost';

let stompClient = null;
let subscriptions = {};

// Connect to the WebSocket server
// userInfo = { id, username, color }
export const connectWebSocket = (sessionId, userInfo, callbacks = {}) => {
  // Guard: presence + change attribution require a valid user object.
  if (!userInfo || !userInfo.id) {
    console.error('[WS] connectWebSocket called without a valid user object', userInfo);
    return;
  }

  // Disconnect any existing connection before creating a new one
  if (stompClient) {
    try {
      Object.values(subscriptions).forEach(sub => { try { sub.unsubscribe(); } catch (e) { } });
      subscriptions = {};
      stompClient.deactivate();
    } catch (e) { /* ignore */ }
    stompClient = null;
  }

  // Create a STOMP client over SockJS.
  // The URL is resolved at connect time (and again on every auto-reconnect),
  // so a session joined on another machine keeps pointing at that machine.
  stompClient = new Client({
    webSocketFactory: () => new SockJS(getWsUrl()),

    onConnect: () => {
      console.log('[WS] Connected to Causify server');

      // Subscribe to code changes
      subscriptions.code = stompClient.subscribe(
        `/topic/session/${sessionId}/code`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onCodeChange) callbacks.onCodeChange(data);
        }
      );

      // Subscribe to user presence updates
      subscriptions.users = stompClient.subscribe(
        `/topic/session/${sessionId}/users`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onUsersChange) callbacks.onUsersChange(data);
        }
      );

      // Subscribe to the owner's file locks. Sent on every join as well as on
      // every change, so a client that arrives late still learns what is frozen.
      subscriptions.locks = stompClient.subscribe(
        `/topic/session/${sessionId}/locks`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onLocksChange) callbacks.onLocksChange(data);
        }
      );

      // Subscribe to the owner's checkpoints, so one press puts the same point
      // in everyone's history.
      subscriptions.checkpoint = stompClient.subscribe(
        `/topic/session/${sessionId}/checkpoint`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onCheckpoint) callbacks.onCheckpoint(data);
        }
      );

      // Subscribe to the lobby — who is waiting to be let in. Only the owner's
      // client renders it, but the list is broadcast to the session like
      // everything else here.
      subscriptions.admission = stompClient.subscribe(
        `/topic/session/${sessionId}/admission`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onAdmissionChange) callbacks.onAdmissionChange(data);
        }
      );

      // Subscribe to execution results
      subscriptions.execution = stompClient.subscribe(
        `/topic/session/${sessionId}/execution`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onExecutionResult) callbacks.onExecutionResult(data);
        }
      );

      // Subscribe to new snapshots
      subscriptions.snapshots = stompClient.subscribe(
        `/topic/session/${sessionId}/snapshot`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onSnapshot) callbacks.onSnapshot(data);
        }
      );

      // Subscribe to remote cursor positions
      subscriptions.cursor = stompClient.subscribe(
        `/topic/session/${sessionId}/cursor`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onCursorUpdate) callbacks.onCursorUpdate(data);
        }
      );

      // Subscribe to file presence ("who is working in which file")
      subscriptions.presence = stompClient.subscribe(
        `/topic/session/${sessionId}/presence`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onPresenceUpdate) callbacks.onPresenceUpdate(data);
        }
      );

      // Subscribe to file/folder deletions
      subscriptions.fileDelete = stompClient.subscribe(
        `/topic/session/${sessionId}/file-delete`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onFileDelete) callbacks.onFileDelete(data);
        }
      );

      // Subscribe to bulk project changes (a folder upload). Individual edits
      // arrive as code changes; this covers the file list changing all at once.
      subscriptions.projectSync = stompClient.subscribe(
        `/topic/session/${sessionId}/project-sync`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onProjectSync) callbacks.onProjectSync(data);
        }
      );

      // Subscribe to whiteboard updates
      subscriptions.whiteboard = stompClient.subscribe(
        `/topic/session/${sessionId}/whiteboard`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onWhiteboardChange) callbacks.onWhiteboardChange(data);
        }
      );

      // Subscribe to revert notifications
      subscriptions.revert = stompClient.subscribe(
        `/topic/session/${sessionId}/revert`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onRevert) callbacks.onRevert(data);
        }
      );

      // Subscribe to voice room signaling (WebRTC)
      subscriptions.voice = stompClient.subscribe(
        `/topic/session/${sessionId}/voice`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onVoiceSignal) callbacks.onVoiceSignal(data);
        }
      );

      // Subscribe to follow mode state updates
      subscriptions.follow = stompClient.subscribe(
        `/topic/session/${sessionId}/follow`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onFollowUpdate) callbacks.onFollowUpdate(data);
        }
      );

      // Subscribe to user kick events
      subscriptions.kick = stompClient.subscribe(
        `/topic/session/${sessionId}/kick`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onUserKicked) callbacks.onUserKicked(data);
        }
      );

      // Subscribe to CRDT (Yjs) document updates, then start the
      // shared document + sync handshake. Text sync now flows through
      // this channel as small binary deltas instead of whole files.
      subscriptions.yjs = stompClient.subscribe(
        `/topic/session/${sessionId}/yjs`,
        (message) => {
          try { handleYjsMessage(JSON.parse(message.body)); } catch (e) { /* ignore */ }
        }
      );
      initCollab(sessionId, userInfo.id, (msg) => {
        if (stompClient && stompClient.connected) {
          stompClient.publish({
            destination: `/app/session/${sessionId}/yjs`,
            body: JSON.stringify(msg),
          });
        }
      });

      // Announce our presence with full user info
      stompClient.publish({
        destination: `/app/session/${sessionId}/join`,
        body: JSON.stringify({
          userId: userInfo.id,
          username: userInfo.username,
          color: userInfo.color || '#6366f1',
        }),
      });

      if (callbacks.onConnected) callbacks.onConnected();
    },

    onDisconnect: () => {
      console.log('[WS] Disconnected');
      if (callbacks.onDisconnected) callbacks.onDisconnected();
    },

    /* onDisconnect only fires for a polite STOMP shutdown. The failures that
     * matter here are not polite: the host's laptop sleeps, the Wi-Fi drops,
     * Cloudflare rotates its edge, the ISP re-assigns an IP. Those surface as
     * a socket close — or, without heartbeats, as nothing at all. */
    onWebSocketClose: () => {
      console.log('[WS] Socket closed');
      if (callbacks.onDisconnected) callbacks.onDisconnected();
    },

    reconnectDelay: 3000,

    /* Ten seconds each way, matching the broker. A dead connection is
     * otherwise invisible: nothing is being sent, so nothing fails, and the
     * socket sits half-open for minutes while edits pile up locally with
     * nowhere to go. Missing a beat is what makes the drop detectable. */
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,

    onStompError: (frame) => {
      console.error('[WS] STOMP error:', frame.headers['message']);
    },
  });

  stompClient.activate();
};

// Send whiteboard updates to other users
export const sendWhiteboardUpdate = (sessionId, update) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/whiteboard`,
      body: JSON.stringify(update),
    });
  }
};

// Send code changes to other users
export const sendCodeChange = (sessionId, userId, path, code) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/code`,
      body: JSON.stringify({ userId, path, code, timestamp: Date.now() }),
    });
  }
};

// Send cursor position for collaborative awareness
export const sendCursorPosition = (sessionId, userId, position) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/cursor`,
      body: JSON.stringify({ userId, ...position }),
    });
  }
};

// Notify everyone that a file/folder was deleted
export const sendFileDelete = (sessionId, userId, path) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/file-delete`,
      body: JSON.stringify({ userId, path }),
    });
  }
};

// Tell peers the project's file list changed as a whole (e.g. a folder upload),
// so they re-read it rather than waiting for per-file edits that never come.
export const sendProjectSync = (sessionId, userId) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/project-sync`,
      body: JSON.stringify({ userId }),
    });
  }
};

// Announce which file this user is currently working in
export const sendFilePresence = (sessionId, presence) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/presence`,
      body: JSON.stringify(presence),
    });
  }
};

// Owner action: set another user's edit permission ('editor' | 'viewer')
export const sendSetPermission = (sessionId, userId, permission) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/permission`,
      body: JSON.stringify({ userId, permission }),
    });
  }
};

/* Owner action: save the project's state as a point in the session's history.
 *
 * Metadata only — the label, who pressed it, the run verdict and the credit
 * list. Every client already holds the same files, so each one captures its own
 * copy locally; putting the project on the wire per checkpoint would be a full
 * duplicate of it for every participant. */
export const sendCheckpoint = (sessionId, meta) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/checkpoint`,
      body: JSON.stringify(meta),
    });
  }
};

// Owner action: answer someone waiting in the lobby. decision: 'admit' | 'deny'
export const sendAdmissionDecision = (sessionId, requestId, decision) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/admission`,
      body: JSON.stringify({ requestId, decision }),
    });
  }
};

// Owner action: freeze or release a single file for everyone else.
export const sendFileLock = (sessionId, path, locked, user) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/lock`,
      body: JSON.stringify({
        path,
        locked,
        userId: user?.id || '',
        username: user?.username || 'the owner',
      }),
    });
  }
};

// Send a revert notification to all users
export const sendRevert = (sessionId, userId, path, username, revertedUser) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/revert`,
      body: JSON.stringify({ userId, path, username, revertedUser, timestamp: Date.now() }),
    });
  }
};

/* ── Voice Room Signaling ── */

export const sendVoiceJoin = (sessionId, userInfo) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/voice/join`,
      body: JSON.stringify({
        userId: userInfo.id,
        username: userInfo.username,
        color: userInfo.color || '#6366f1',
      }),
    });
  }
};

export const sendVoiceLeave = (sessionId, userInfo) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/voice/leave`,
      body: JSON.stringify({
        userId: userInfo.id,
        username: userInfo.username,
      }),
    });
  }
};

export const sendVoiceSignal = (sessionId, signalData) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/voice/signal`,
      body: JSON.stringify(signalData),
    });
  }
};

/* ── Follow Mode ── */

export const sendFollowStart = (sessionId, followerId, leaderId) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/follow/start`,
      body: JSON.stringify({ followerId, leaderId }),
    });
  }
};

export const sendFollowStop = (sessionId, followerId, leaderId) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/follow/stop`,
      body: JSON.stringify({ followerId, leaderId }),
    });
  }
};

export const sendFollowState = (sessionId, editorState) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/follow/state`,
      body: JSON.stringify(editorState),
    });
  }
};

// Kick a user from the session (only owners should call this)
export const sendKickUser = (sessionId, userId) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/kick`,
      body: JSON.stringify({ userId }),
    });
  }
};

// Disconnect from WebSocket
export const disconnectWebSocket = () => {
  destroyCollab();
  if (stompClient) {
    Object.values(subscriptions).forEach((sub) => {
      try { sub.unsubscribe(); } catch (e) { /* ignore */ }
    });
    subscriptions = {};
    stompClient.deactivate();
    stompClient = null;
  }
};

// Check if WebSocket is currently connected
export const isConnected = () => {
  return stompClient && stompClient.connected;
};
