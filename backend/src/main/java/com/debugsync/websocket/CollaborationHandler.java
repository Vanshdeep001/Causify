/*
 * CollaborationHandler.java — WebSocket message handler for real-time collab
 *
 * Handles: code sync, user presence, cursors, whiteboard, reverts,
 *          voice room signaling (WebRTC), and follow mode state relay.
 */
package com.debugsync.websocket;

import com.debugsync.service.CollaborationService;
import com.debugsync.service.FileService;
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
    private final FileService fileService;
    private final WhiteboardService whiteboardService;

    public CollaborationHandler(CollaborationService collaborationService, SimpMessagingTemplate messagingTemplate, FileService fileService, WhiteboardService whiteboardService) {
        this.collaborationService = collaborationService;
        this.messagingTemplate = messagingTemplate;
        this.fileService = fileService;
        this.whiteboardService = whiteboardService;
    }

    @MessageMapping("/session/{sessionId}/code")
    public void handleCodeChange(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.debug("Code change in session {} for file {} from user {}", 
            sessionId, payload.get("path"), payload.get("userId"));
        
        String path = (String) payload.get("path");
        String code = (String) payload.get("code");
        if (path != null && code != null) {
            fileService.saveFile(sessionId, path, code);
        }
        
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
