/*
 * CollaborationService.java — Manages real-time collaboration state
 */
package com.debugsync.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class CollaborationService {

    private static final Logger log = LoggerFactory.getLogger(CollaborationService.class);
    private final Map<String, Set<Map<String, String>>> sessionUsers = new ConcurrentHashMap<>();

    public List<Map<String, String>> addUser(String sessionId, String userId, String username, String color) {
        sessionUsers.computeIfAbsent(sessionId, k -> ConcurrentHashMap.newKeySet());
        Map<String, String> userInfo = new HashMap<>();
        userInfo.put("id", userId);
        userInfo.put("username", username);
        userInfo.put("color", color);
        sessionUsers.get(sessionId).add(userInfo);
        log.info("User {} joined session {}", username, sessionId);
        return new ArrayList<>(sessionUsers.get(sessionId));
    }

    public List<Map<String, String>> removeUser(String sessionId, String userId) {
        Set<Map<String, String>> users = sessionUsers.get(sessionId);
        if (users != null) users.removeIf(u -> userId.equals(u.get("id")));
        log.info("User {} left session {}", userId, sessionId);
        return users != null ? new ArrayList<>(users) : Collections.emptyList();
    }

    public List<Map<String, String>> getUsers(String sessionId) {
        Set<Map<String, String>> users = sessionUsers.get(sessionId);
        return users != null ? new ArrayList<>(users) : Collections.emptyList();
    }
}
