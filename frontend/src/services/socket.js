/* -------------------------------------------------------
 * socket.js — WebSocket Client Service
 * 
 * Manages STOMP-over-WebSocket connection to the backend
 * for real-time collaboration features:
 *   - Code sync between users
 *   - User presence (join/leave)
 *   - Live execution results
 * ------------------------------------------------------- */

import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client/dist/sockjs';

let stompClient = null;
let subscriptions = {};

// Connect to the WebSocket server
// userInfo = { id, username, color }
export const connectWebSocket = (sessionId, userInfo, callbacks = {}) => {
  // Disconnect any existing connection before creating a new one
  if (stompClient) {
    try {
      Object.values(subscriptions).forEach(sub => { try { sub.unsubscribe(); } catch(e) {} });
      subscriptions = {};
      stompClient.deactivate();
    } catch (e) { /* ignore */ }
    stompClient = null;
  }

  // Create a STOMP client over SockJS
  stompClient = new Client({
    // Use SockJS as the transport
    webSocketFactory: () => new SockJS('/ws'),

    // Called when connection is established
    onConnect: () => {
      console.log('[WS] Connected to Causify server');

      // Subscribe to code changes in this session
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

      // Subscribe to revert notifications
      subscriptions.revert = stompClient.subscribe(
        `/topic/session/${sessionId}/revert`,
        (message) => {
          const data = JSON.parse(message.body);
          if (callbacks.onRevert) callbacks.onRevert(data);
        }
      );

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

    // Called when connection is lost
    onDisconnect: () => {
      console.log('[WS] Disconnected');
      if (callbacks.onDisconnected) callbacks.onDisconnected();
    },

    // Reconnect settings
    reconnectDelay: 3000,

    // Error handler
    onStompError: (frame) => {
      console.error('[WS] STOMP error:', frame.headers['message']);
    },
  });

  stompClient.activate();
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

// Send a revert notification to all users
export const sendRevert = (sessionId, userId, path, username, revertedUser) => {
  if (stompClient && stompClient.connected) {
    stompClient.publish({
      destination: `/app/session/${sessionId}/revert`,
      body: JSON.stringify({ userId, path, username, revertedUser, timestamp: Date.now() }),
    });
  }
};

// Disconnect from WebSocket
export const disconnectWebSocket = () => {
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
