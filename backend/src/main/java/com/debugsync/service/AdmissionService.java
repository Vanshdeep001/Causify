/*
 * AdmissionService.java — the waiting room
 *
 * Knowing the session code and password used to BE the join. That is a
 * reasonable rule for a code you hand to one person, and a bad one for a code
 * that gets forwarded: it is pasted into a chat, quoted in a reply, and read by
 * whoever scrolls up. Once it leaks there is no way to notice, because there
 * was never a moment where anyone decided anything.
 *
 * So the password now buys a knock rather than a seat. The owner sees who is
 * asking and lets them in — the same shape as a meeting lobby, for the same
 * reason: the person who owns the room is the one who should be choosing.
 *
 * This gate is real, not cosmetic. Files and the API token are handed out by
 * /session/join, and that endpoint will not run without an admitted request to
 * spend. Somebody holding the password but not an admission gets a 403 and an
 * empty file list, not a locked-looking UI over a full one.
 *
 * In memory, like SessionTokenStore and for the same reason: a request that
 * outlived a restart would point at a session that no longer exists.
 */
package com.debugsync.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AdmissionService {

    private static final Logger log = LoggerFactory.getLogger(AdmissionService.class);

    /* Long enough that the owner can be mid-sentence when the knock lands,
     * short enough that a forgotten request does not sit in the list all
     * afternoon looking like someone is still waiting. */
    private static final long PENDING_TTL_MS = 3 * 60 * 1000L;

    /* A decided request has to outlive the decision: the person waiting learns
     * their answer by asking for it, and they are asking every couple of
     * seconds, not instantly. */
    private static final long DECIDED_TTL_MS = 60 * 1000L;

    /** requestId -> { sessionId, username, status, createdAt, decidedAt } */
    private final Map<String, Map<String, Object>> requests = new ConcurrentHashMap<>();

    public String knock(String sessionId, String username) {
        sweep();
        String requestId = UUID.randomUUID().toString().substring(0, 12);

        Map<String, Object> req = new ConcurrentHashMap<>();
        req.put("requestId", requestId);
        req.put("sessionId", sessionId);
        req.put("username", username != null && !username.isBlank() ? username : "Someone");
        req.put("status", "pending");
        req.put("createdAt", System.currentTimeMillis());
        requests.put(requestId, req);

        log.info("Admission requested by {} for session {}", username, sessionId);
        return requestId;
    }

    /** @return the request as the waiting client should see it, or null. */
    public Map<String, Object> get(String requestId) {
        sweep();
        Map<String, Object> req = requests.get(requestId);
        return req == null ? null : new HashMap<>(req);
    }

    /** Owner's answer. Returns false when the request has already gone. */
    public boolean decide(String requestId, boolean admit) {
        sweep();
        Map<String, Object> req = requests.get(requestId);
        if (req == null || !"pending".equals(req.get("status"))) return false;

        req.put("status", admit ? "admitted" : "denied");
        req.put("decidedAt", System.currentTimeMillis());
        log.info("Admission {} for request {}", admit ? "granted" : "refused", requestId);
        return true;
    }

    /**
     * Spend an admission. One join per knock: without this, an admitted request
     * id would be a reusable key to the session, which is the thing the lobby
     * exists to stop.
     */
    public boolean consumeAdmitted(String requestId, String sessionId) {
        if (requestId == null) return false;
        Map<String, Object> req = requests.get(requestId);
        if (req == null) return false;
        if (!"admitted".equals(req.get("status"))) return false;
        if (!Objects.equals(sessionId, req.get("sessionId"))) return false;

        requests.remove(requestId);
        return true;
    }

    /** Someone gave up waiting. */
    public void withdraw(String requestId) {
        if (requestId != null) requests.remove(requestId);
    }

    /** Everyone currently waiting at this session's door, oldest first. */
    public List<Map<String, Object>> pendingFor(String sessionId) {
        sweep();
        List<Map<String, Object>> pending = new ArrayList<>();
        requests.values().forEach((req) -> {
            if (Objects.equals(sessionId, req.get("sessionId")) && "pending".equals(req.get("status"))) {
                Map<String, Object> copy = new HashMap<>();
                copy.put("requestId", req.get("requestId"));
                copy.put("username", req.get("username"));
                copy.put("createdAt", req.get("createdAt"));
                pending.add(copy);
            }
        });
        pending.sort(Comparator.comparingLong((m) -> ((Number) m.get("createdAt")).longValue()));
        return pending;
    }

    public void purgeSession(String sessionId) {
        requests.entrySet().removeIf((e) -> Objects.equals(sessionId, e.getValue().get("sessionId")));
    }

    /* Called on the way into every operation rather than on a timer: the map is
     * tiny, and a scheduled task would be one more thing to keep alive for a
     * structure that is empty most of the time. */
    private void sweep() {
        long now = System.currentTimeMillis();
        requests.entrySet().removeIf((e) -> {
            Map<String, Object> req = e.getValue();
            long created = ((Number) req.getOrDefault("createdAt", 0L)).longValue();
            if ("pending".equals(req.get("status"))) return now - created > PENDING_TTL_MS;
            long decided = ((Number) req.getOrDefault("decidedAt", created)).longValue();
            return now - decided > DECIDED_TTL_MS;
        });
    }
}
