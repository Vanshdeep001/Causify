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
        Set<Map<String, String>> users = sessionUsers.computeIfAbsent(sessionId, k -> ConcurrentHashMap.newKeySet());

        // Carry over an existing permission across reconnects, and dedup by id
        // (a re-joining user must not create a second row).
        String permission = users.stream()
            .filter(u -> userId.equals(u.get("id")))
            .map(u -> u.getOrDefault("permission", "editor"))
            .findFirst()
            .orElse("editor"); // new collaborators can edit by default

        users.removeIf(u -> userId.equals(u.get("id")));

        Map<String, String> userInfo = new HashMap<>();
        userInfo.put("id", userId);
        userInfo.put("username", username);
        userInfo.put("color", color);
        userInfo.put("permission", permission);
        users.add(userInfo);
        log.info("User {} joined session {} (permission={})", username, sessionId, permission);
        return new ArrayList<>(users);
    }

    /**
     * Owner-controlled access: set a user's permission to "editor" or "viewer".
     * Removes-then-re-adds the element so the backing hash set stays consistent
     * after the map's contents (and hashCode) change.
     */
    public List<Map<String, String>> setPermission(String sessionId, String userId, String permission) {
        Set<Map<String, String>> users = sessionUsers.get(sessionId);
        if (users == null) return Collections.emptyList();

        Map<String, String> target = users.stream()
            .filter(u -> userId.equals(u.get("id")))
            .findFirst()
            .orElse(null);

        if (target != null) {
            users.remove(target);
            target.put("permission", "viewer".equals(permission) ? "viewer" : "editor");
            users.add(target);
            log.info("User {} permission set to {} in session {}", userId, permission, sessionId);
        }
        return new ArrayList<>(users);
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
