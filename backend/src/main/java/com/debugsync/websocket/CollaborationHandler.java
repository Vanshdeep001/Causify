/*
 * CollaborationHandler.java — WebSocket message handler for real-time collab
 */
package com.debugsync.websocket;

import com.debugsync.service.CollaborationService;
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

    public CollaborationHandler(CollaborationService collaborationService, SimpMessagingTemplate messagingTemplate) {
        this.collaborationService = collaborationService;
        this.messagingTemplate = messagingTemplate;
    }

    @MessageMapping("/session/{sessionId}/code")
    public void handleCodeChange(@DestinationVariable String sessionId, @Payload Map<String, Object> payload) {
        log.debug("Code change in session {} for file {} from user {}", 
            sessionId, payload.get("path"), payload.get("userId"));
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/code", payload);
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
}
