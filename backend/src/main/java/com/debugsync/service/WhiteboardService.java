/*
 * WhiteboardService.java — Op-based whiteboard persistence
 *
 * The whiteboard syncs live over WebSocket as per-element operations
 * (add / update / delete / clear). This service persists those SAME ops
 * into the session's stored board by merging on element id, instead of
 * letting each client overwrite the whole board blob. That removes the
 * last-write-wins race where one client's stale full-board snapshot could
 * wipe out another user's just-drawn element on reload.
 */
package com.debugsync.service;

import com.debugsync.model.Session;
import com.debugsync.repository.SessionRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class WhiteboardService {

    private static final Logger log = LoggerFactory.getLogger(WhiteboardService.class);

    private final SessionRepository sessionRepository;
    private final ObjectMapper objectMapper;

    // Per-session lock so concurrent element ops serialize their
    // read-modify-write and can't clobber each other.
    private final Map<String, Object> locks = new ConcurrentHashMap<>();

    public WhiteboardService(SessionRepository sessionRepository, ObjectMapper objectMapper) {
        this.sessionRepository = sessionRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * Apply one whiteboard op to the persisted board.
     * payload = { type: 'add'|'update'|'delete'|'clear', element, elementId }
     */
    public void applyOp(String sessionId, Map<String, Object> payload) {
        if (sessionId == null || payload == null) return;
        String type = (String) payload.get("type");
        if (type == null) return;

        Object lock = locks.computeIfAbsent(sessionId, k -> new Object());
        synchronized (lock) {
            try {
                Optional<Session> sessionOpt = sessionRepository.findById(sessionId);
                if (sessionOpt.isEmpty()) return;
                Session session = sessionOpt.get();

                List<Map<String, Object>> elements = parse(session.getWhiteboardData());

                switch (type) {
                    case "add":
                    case "update": {
                        Object elObj = payload.get("element");
                        if (!(elObj instanceof Map)) return;
                        @SuppressWarnings("unchecked")
                        Map<String, Object> element = (Map<String, Object>) elObj;
                        Object id = element.get("id");
                        if (id == null) return;
                        // Replace in place (preserves render/z-order) or append if new.
                        boolean replaced = false;
                        for (int i = 0; i < elements.size(); i++) {
                            if (id.equals(elements.get(i).get("id"))) {
                                elements.set(i, element);
                                replaced = true;
                                break;
                            }
                        }
                        if (!replaced) elements.add(element);
                        break;
                    }
                    case "delete": {
                        Object id = payload.get("elementId");
                        if (id == null) return;
                        elements.removeIf(el -> id.equals(el.get("id")));
                        break;
                    }
                    case "clear": {
                        elements.clear();
                        break;
                    }
                    default:
                        return;
                }

                session.setWhiteboardData(objectMapper.writeValueAsString(elements));
                sessionRepository.save(session);
            } catch (Exception e) {
                log.warn("Failed to persist whiteboard op for session {}: {}", sessionId, e.getMessage());
            }
        }
    }

    private List<Map<String, Object>> parse(String json) {
        if (json == null || json.trim().isEmpty()) return new ArrayList<>();
        try {
            List<Map<String, Object>> list =
                objectMapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {});
            return list != null ? new ArrayList<>(list) : new ArrayList<>();
        } catch (Exception e) {
            log.warn("Corrupt whiteboardData for a session, resetting to empty: {}", e.getMessage());
            return new ArrayList<>();
        }
    }
}
