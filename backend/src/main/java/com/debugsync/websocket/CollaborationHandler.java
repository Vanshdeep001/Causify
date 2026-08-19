/*
 * CollaborationHandler.java — WebSocket message handler for real-time collab
 *
 * Handles: code sync, user presence, cursors, whiteboard, reverts,
 *          voice room signaling (WebRTC), and follow mode state relay.
 */
package com.debugsync.websocket;

import com.debugsync.service.AdmissionService;
import com.debugsync.service.CollaborationService;
import com.debugsync.service.WhiteboardService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.*;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.*;

@Controller
public class CollaborationHandler {

    private static final Logger log = LoggerFactory.getLogger(CollaborationHandler.class);
    private final CollaborationService collaborationService;
    private final SimpMessagingTemplate messagingTemplate;
    private final WhiteboardService whiteboardService;
    private final AdmissionService admissionService;

    public CollaborationHandler(CollaborationService collaborationService, SimpMessagingTemplate messagingTemplate, WhiteboardService whiteboardService, AdmissionService admissionService) {
        this.collaborationService = collaborationService;
        this.messagingTemplate = messagingTemplate;
        this.whiteboardService = whiteboardService;
        this.admissionService = admissionService;
    }

    @MessageMapping("/session/{sessionId}/code")
    public void handleCodeChange(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.debug("Code change in session {} for file {} from user {}", 
            sessionId, payload.get("path"), payload.get("userId"));
        
        // Relay only. This used to write to the database on every keystroke
        // batch, which put a full row update on the hot path of typing — the
        // dominant source of write pressure on the store. Persistence is already
        // handled by the debounced REST save the client schedules (see
        // collabDoc.schedulePersist), and in local mode by the write to disk.
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/code", payload);
    }

    /* ────────────────────────────────────────────────────────────
     * CRDT (Yjs) Document Sync
     * The backend is a pure relay: it rebroadcasts each client's
     * base64-encoded Yjs update / sync message to every peer. It does
     * not need to understand the CRDT payload. Plain text is persisted
     * separately via the REST save-file endpoint (debounced client-side).
     * ──────────────────────────────────────────────────────────── */
    @MessageMapping("/session/{sessionId}/yjs")
    public void handleYjs(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/yjs", payload);
    }

    /**
     * File/folder deletion. The initiating client already removed it via REST;
     * this simply tells the other clients to drop it from their file tree.
     */
    @MessageMapping("/session/{sessionId}/file-delete")
    public void handleFileDelete(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.info("File deleted in session {}: {}", sessionId, payload.get("path"));
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/file-delete", payload);

        // A lock on a path that no longer exists has no way to be lifted, and
        // would silently re-freeze the file if the path were ever recreated.
        Object path = payload.get("path");
        if (path != null) {
            collaborationService.clearFileLock(sessionId, String.valueOf(path));
            broadcastLocks(sessionId, collaborationService.getFileLocks(sessionId));
        }
    }

    /**
     * The project's file list changed wholesale — an upload, or a folder shared
     * into the session.
     *
     * Single-file edits travel as code changes, but a bulk upload goes over REST
     * and would otherwise be invisible to everyone else: collaborators sat on
     * "waiting for the owner to upload files" while the files were already there.
     * This carries no payload; it simply tells peers to re-read the file list.
     */
    @MessageMapping("/session/{sessionId}/project-sync")
    public void handleProjectSync(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.info("Project files synced in session {}", sessionId);
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/project-sync", payload);
    }

    @MessageMapping("/session/{sessionId}/join")
    public void handleUserJoin(@DestinationVariable String sessionId, @Payload Map<String, String> payload) {
        String userId = payload.getOrDefault("userId", "unknown");
        String username = payload.getOrDefault("username", "User");
        String color = payload.getOrDefault("color", "#6366f1");
        log.info("User {} joining session {}", username, sessionId);

        List<Map<String, String>> users = collaborationService.addUser(sessionId, userId, username, color);
        Map<String, Object> response = new HashMap<>();
        response.put("users", users);
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/users", response);

        // Whoever just arrived has no idea which files are frozen. Re-broadcast
        // the lock map on every join: the newcomer gets the current state, and
        // everyone else harmlessly re-applies what they already have.
        broadcastLocks(sessionId, collaborationService.getFileLocks(sessionId));

        // Same for the lobby: an owner who just reconnected needs to be told
        // that somebody is still standing outside.
        Map<String, Object> lobby = new HashMap<>();
        lobby.put("pending", admissionService.pendingFor(sessionId));
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/admission", lobby);
    }

    @MessageMapping("/session/{sessionId}/cursor")
    public void handleCursorUpdate(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/cursor", payload);
    }

    /**
     * File presence — "who is currently working in which file". Relayed so
     * every client can show the active users on each file. Kept lightweight;
     * the client re-announces on file switch and when a new peer joins.
     */
    @MessageMapping("/session/{sessionId}/presence")
    public void handleFilePresence(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/presence", payload);
    }

    /**
     * Owner-controlled edit permission. The owner sends { userId, permission }.
     * We update the stored user and rebroadcast the full users list so every
     * client (including the affected user) picks up the new access level.
     */
    @MessageMapping("/session/{sessionId}/permission")
    public void handleSetPermission(@DestinationVariable String sessionId, @Payload Map<String, String> payload) {
        String userId = payload.get("userId");
        String permission = payload.get("permission");
        log.info("Setting permission {} for user {} in session {}", permission, userId, sessionId);

        List<Map<String, String>> users = collaborationService.setPermission(sessionId, userId, permission);
        Map<String, Object> response = new HashMap<>();
        response.put("users", users);
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/users", response);
    }

    /**
     * A checkpoint the owner asked for. Pure relay.
     *
     * Only metadata crosses the wire — label, author, run verdict, credit list.
     * Every client holds the same project already, so each captures its own copy
     * of the files locally; broadcasting them would put a full duplicate of the
     * project on the wire once per participant, per save.
     */
    @MessageMapping("/session/{sessionId}/checkpoint")
    public void handleCheckpoint(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.info("Checkpoint saved in session {} by {}", sessionId, payload.get("by"));
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/checkpoint", payload);
    }

    /**
     * Owner-controlled file lock. The owner sends { path, locked, userId, username }
     * and every client receives the session's complete lock map back.
     *
     * Like the permission handler above, this trusts the sender: the socket
     * carries no identity the server can check, so "only the owner may lock" is
     * enforced where the button lives. The server's job here is to be the one
     * copy of the truth that survives a refresh, not a bouncer.
     */
    @MessageMapping("/session/{sessionId}/lock")
    public void handleFileLock(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        String path = String.valueOf(payload.get("path"));
        boolean locked = Boolean.TRUE.equals(payload.get("locked"));
        String userId = payload.get("userId") != null ? String.valueOf(payload.get("userId")) : null;
        String username = payload.get("username") != null ? String.valueOf(payload.get("username")) : null;

        broadcastLocks(sessionId, collaborationService.setFileLock(sessionId, path, locked, userId, username));
    }

    /**
     * The owner's answer to someone waiting in the lobby:
     * { requestId, decision: "admit" | "deny" }.
     *
     * The waiting client is not in this session's topics yet — that is the whole
     * point — so it learns the outcome by polling /session/{id}/knock/{req}.
     * What goes out here is the refreshed pending list, which is what the
     * owner's own list is drawn from.
     */
    @MessageMapping("/session/{sessionId}/admission")
    public void handleAdmission(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        String requestId = payload.get("requestId") != null ? String.valueOf(payload.get("requestId")) : null;
        boolean admit = "admit".equals(payload.get("decision"));

        admissionService.decide(requestId, admit);

        Map<String, Object> response = new HashMap<>();
        response.put("pending", admissionService.pendingFor(sessionId));
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/admission", response);
    }

    private void broadcastLocks(String sessionId, Map<String, Map<String, String>> locks) {
        Map<String, Object> response = new HashMap<>();
        response.put("locks", locks);
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/locks", response);
    }

    @MessageMapping("/session/{sessionId}/whiteboard")
    public void handleWhiteboardUpdate(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.debug("Whiteboard update in session {}", sessionId);
        // Relay live to peers first, then merge the op into the persisted board
        // (op-based persistence — no whole-board last-write-wins overwrite).
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/whiteboard", payload);
        whiteboardService.applyOp(sessionId, payload);
    }

    @MessageMapping("/session/{sessionId}/revert")
    public void handleRevert(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.info("Revert in session {} for file {} by user {}", 
            sessionId, payload.get("path"), payload.get("username"));
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/revert", payload);
    }

    /* ────────────────────────────────────────────────────────────
     * Voice Room — WebRTC Signaling
     * The backend only relays signaling messages (SDP offer/answer,
     * ICE candidates) between peers. No media processing.
     * ──────────────────────────────────────────────────────────── */

    @MessageMapping("/session/{sessionId}/voice/join")
    public void handleVoiceJoin(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.info("User {} joined voice room in session {}", payload.get("userId"), sessionId);
        payload.put("type", "voice-join");
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/voice", payload);
    }

    @MessageMapping("/session/{sessionId}/voice/leave")
    public void handleVoiceLeave(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.info("User {} left voice room in session {}", payload.get("userId"), sessionId);
        payload.put("type", "voice-leave");
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/voice", payload);
    }

    @MessageMapping("/session/{sessionId}/voice/signal")
    public void handleVoiceSignal(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        // Relay WebRTC signaling data (SDP offer/answer, ICE candidates) to all peers
        payload.put("type", "voice-signal");
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/voice", payload);
    }

    /* ────────────────────────────────────────────────────────────
     * Follow Mode — Editor State Relay
     * Broadcasts lightweight editor state (file, scroll, cursor,
     * selection) from leader to followers. No video/pixels.
     * ──────────────────────────────────────────────────────────── */

    @MessageMapping("/session/{sessionId}/follow/start")
    public void handleFollowStart(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.info("User {} started following user {} in session {}",
            payload.get("followerId"), payload.get("leaderId"), sessionId);
        payload.put("type", "follow-start");
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/follow", payload);
    }

    @MessageMapping("/session/{sessionId}/follow/stop")
    public void handleFollowStop(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.info("User {} stopped following user {} in session {}",
            payload.get("followerId"), payload.get("leaderId"), sessionId);
        payload.put("type", "follow-stop");
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/follow", payload);
    }

    @MessageMapping("/session/{sessionId}/follow/state")
    public void handleFollowState(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        // Relay leader's editor state to all followers
        payload.put("type", "follow-state");
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/follow", payload);
    }

    @MessageMapping("/session/{sessionId}/kick")
    public void handleUserKick(@DestinationVariable String sessionId, @Payload Map<String, String> payload) {
        String userId = payload.get("userId");
        log.info("User {} is being kicked from session {}", userId, sessionId);

        List<Map<String, String>> users = collaborationService.removeUser(sessionId, userId);
        
        // Broadcast updated users list
        Map<String, Object> usersResponse = new HashMap<>();
        usersResponse.put("users", users);
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/users", usersResponse);

        // Broadcast kick event
        Map<String, Object> kickResponse = new HashMap<>();
        kickResponse.put("userId", userId);
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/kick", kickResponse);
    }
}
