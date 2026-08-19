/*
 * SessionController.java — REST endpoints for session management
 */
package com.debugsync.controller;

import com.debugsync.model.Session;
import com.debugsync.repository.SessionRepository;
import com.debugsync.service.AdmissionService;
import com.debugsync.service.CollaborationService;
import com.debugsync.config.SessionTokenStore;
import com.debugsync.service.FileService;
import com.debugsync.service.SessionCleanupService;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/session")
public class SessionController {

    private final SessionRepository sessionRepository;
    private final FileService fileService;
    private final CollaborationService collaborationService;
    private final SessionCleanupService sessionCleanupService;
    private final SessionTokenStore tokenStore;
    private final AdmissionService admissionService;
    private final SimpMessagingTemplate messagingTemplate;

    public SessionController(SessionRepository sessionRepository,
                             FileService fileService,
                             CollaborationService collaborationService,
                             SessionCleanupService sessionCleanupService,
                             SessionTokenStore tokenStore,
                             AdmissionService admissionService,
                             SimpMessagingTemplate messagingTemplate) {
        this.tokenStore = tokenStore;
        this.sessionRepository = sessionRepository;
        this.fileService = fileService;
        this.collaborationService = collaborationService;
        this.sessionCleanupService = sessionCleanupService;
        this.admissionService = admissionService;
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Leave a session, and delete it once nobody is left.
     *
     * A session exists to carry files to collaborators while they are connected;
     * it is not storage. Holding its rows after everyone has gone is what let the
     * database grow without bound.
     */
    @PostMapping("/leave")
    public ResponseEntity<Map<String, Object>> leaveSession(@RequestBody Map<String, String> body) {
        String sessionId = body.get("sessionId");
        String userId = body.get("userId");

        if (sessionId == null || sessionId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("message", "sessionId is required"));
        }

        List<Map<String, String>> remaining = userId == null
            ? collaborationService.getUsers(sessionId)
            : collaborationService.removeUser(sessionId, userId);

        /* An empty session used to be deleted on the spot, which made "everybody
         * stepped out for lunch" indistinguishable from "this work is finished"
         * — and answered both by throwing the project away. For anyone who has
         * not cloned it locally, the session is the only copy of that work.
         *
         * It is kept now, and touched so the retention clock starts from the
         * moment the last person left. SessionCleanupService still sweeps
         * sessions nobody comes back to (debugsync.session.retention-hours),
         * so this defers the deletion rather than cancelling it. */
        boolean deserted = remaining.isEmpty();
        if (deserted) {
            sessionRepository.findById(sessionId).ifPresent((session) -> {
                session.setLastActiveAt(java.time.LocalDateTime.now());
                sessionRepository.save(session);
            });
        }

        return ResponseEntity.ok(Map.of(
            "purged", false,
            "deserted", deserted,
            "remainingUsers", remaining.size()));
    }

    @PostMapping("/create")
    public ResponseEntity<Map<String, Object>> createSession(@RequestBody Map<String, String> body) {
        String name = body.getOrDefault("name", "Debug Session");
        String username = body.getOrDefault("username", "Owner");
        String password = body.get("password");

        String userId = UUID.randomUUID().toString().substring(0, 8);

        Session session = new Session();
        session.setName(name);
        session.setPassword(password);
        session.setCurrentCode("");
        // Recorded so ownership survives everybody leaving — see Session.ownerUserId.
        session.setOwnerUserId(userId);
        session.setOwnerName(username);
        session = sessionRepository.save(session);

        Map<String, Object> response = new HashMap<>();
        response.put("id", session.getId());
        response.put("name", session.getName());
        response.put("userId", userId);
        response.put("role", "owner");
        /* Proof of membership for calls that arrive through the tunnel. The
         * host's own requests are local and never checked, but the owner may be
         * reaching their session from another machine. */
        response.put("token", tokenStore.issue(session.getId()));
        // Full user object the client uses for presence + change attribution
        response.put("user", Map.of("id", userId, "username", username, "color", "#FF2E93"));

        return ResponseEntity.ok(response);
    }

    /**
     * Ask to be let in. The password is checked here, so a wrong one still fails
     * fast and never reaches the owner as a knock — the lobby is for deciding
     * about people, not for triaging typos.
     *
     * Hands back a request id and nothing else. No token, no files, no session
     * name: everything worth having waits on the owner.
     */
    @PostMapping("/knock")
    public ResponseEntity<?> knock(@RequestBody Map<String, String> body) {
        String id = body.get("id");
        String password = body.get("password");
        String username = body.getOrDefault("username", "Collaborator");

        Optional<Session> sessionOpt = sessionRepository.findById(id);
        if (sessionOpt.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("message", "Session not found"));
        }
        Session session = sessionOpt.get();
        if (session.getPassword() != null && !session.getPassword().equals(password)) {
            return ResponseEntity.status(401).body(Map.of("message", "Invalid password"));
        }

        String requestId = admissionService.knock(id, username);

        /* A resumed session has nobody in it to admit anyone, so a lobby would
         * lock the room and throw away the key. With the room empty the password
         * is the only credential there is — and it is the one the owner set — so
         * the first person back in is let straight through. */
        if (collaborationService.getUsers(id).isEmpty()) {
            admissionService.decide(requestId, true);
            return ResponseEntity.ok(Map.of("requestId", requestId, "status", "admitted"));
        }

        broadcastPending(id);
        return ResponseEntity.ok(Map.of("requestId", requestId, "status", "pending"));
    }

    /**
     * The waiting client asks whether it has been decided yet. Polled rather
     * than pushed: a socket opened before admission would already be inside the
     * session's topics, which is the thing being gated.
     */
    @GetMapping("/{id}/knock/{requestId}")
    public ResponseEntity<?> knockStatus(@PathVariable String id, @PathVariable String requestId) {
        Map<String, Object> req = admissionService.get(requestId);
        // Gone means expired or already spent. Either way there is nothing to
        // wait for, and saying so beats spinning forever.
        if (req == null || !id.equals(req.get("sessionId"))) {
            return ResponseEntity.ok(Map.of("status", "expired"));
        }
        return ResponseEntity.ok(Map.of("status", req.get("status")));
    }

    /** Gave up waiting — take the knock off the owner's list. */
    @PostMapping("/knock/cancel")
    public ResponseEntity<?> cancelKnock(@RequestBody Map<String, String> body) {
        String id = body.get("id");
        admissionService.withdraw(body.get("requestId"));
        if (id != null) broadcastPending(id);
        return ResponseEntity.ok(Map.of("cancelled", true));
    }

    private void broadcastPending(String sessionId) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("pending", admissionService.pendingFor(sessionId));
        messagingTemplate.convertAndSend("/topic/session/" + sessionId + "/admission", payload);
    }

    @PostMapping("/join")
    public ResponseEntity<?> joinSession(@RequestBody Map<String, String> body) {
        String id = body.get("id");
        String password = body.get("password");
        String username = body.getOrDefault("username", "Collaborator");
        String requestId = body.get("requestId");

        Optional<Session> sessionOpt = sessionRepository.findById(id);
        if (sessionOpt.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("message", "Session not found"));
        }

        Session session = sessionOpt.get();
        if (session.getPassword() != null && !session.getPassword().equals(password)) {
            return ResponseEntity.status(401).body(Map.of("message", "Invalid password"));
        }

        /* The real gate. Knowing the password gets you as far as the previous
         * line; an admission the owner granted is what gets you past this one.
         * Spent on use, so an id cannot be replayed into a second seat. */
        if (!admissionService.consumeAdmitted(requestId, id)) {
            return ResponseEntity.status(403).body(Map.of(
                "message", "The session owner has not let you in yet."));
        }

        String userId = UUID.randomUUID().toString().substring(0, 8);

        /* Who is in charge when somebody reopens a deserted session.
         *
         * The recorded owner is always the owner, whenever they come back and
         * whoever else arrived first. Only when the session never recorded one
         * — it predates this field — does first-in-the-door still apply, and
         * only for an empty room: a session with nobody in it and no named
         * owner would otherwise come back permanently read-only, with no one
         * able to lock a file, admit a guest or restore a checkpoint. */
        boolean deserted = collaborationService.getUsers(id).isEmpty();
        String recordedOwner = session.getOwnerUserId();
        boolean isRecordedOwner = recordedOwner != null
            && recordedOwner.equals(body.get("asUserId"));
        boolean claimsEmptyRoom = deserted && (recordedOwner == null || recordedOwner.isBlank());
        boolean owns = isRecordedOwner || claimsEmptyRoom;

        // Load all project files so the collaborator gets the full file tree
        List<Map<String, String>> files = fileService.getFilesForSession(id);

        Map<String, Object> response = new HashMap<>();
        response.put("id", session.getId());
        response.put("name", session.getName());
        response.put("userId", userId);
        response.put("role", owns ? "owner" : "collaborator");
        // So a returning owner's client can present the same identity next time.
        if (owns && (recordedOwner == null || recordedOwner.isBlank())) {
            session.setOwnerUserId(userId);
            session.setOwnerName(username);
            sessionRepository.save(session);
        }
        response.put("ownerName", session.getOwnerName());
        // Only reached once the password check above has passed, so this is the
        // point where "knows the password" becomes "may call the API".
        response.put("token", tokenStore.issue(session.getId()));
        response.put("files", files);
        // Full user object the client uses for presence + change attribution
        response.put("user", Map.of("id", userId, "username", username, "color", "#4DD6FF"));

        return ResponseEntity.ok(response);
    }

    // Flat endpoint for bulk upload
    @PostMapping("/upload")
    public ResponseEntity<?> uploadProject(@RequestParam String sessionId,
            @RequestBody List<Map<String, String>> files) {
        if (!sessionRepository.existsById(sessionId)) {
            return ResponseEntity.status(404).body("Session not found");
        }
        return ResponseEntity.ok(fileService.uploadFiles(sessionId, files));
    }

    // Flat endpoint for single file save
    @PostMapping("/save-file")
    public ResponseEntity<?> saveFile(@RequestBody Map<String, String> fileData) {
        String sessionId = fileData.get("sessionId");
        String path = fileData.get("path");
        String content = fileData.get("content");

        if (sessionId == null || sessionId.isEmpty()) {
            return ResponseEntity.badRequest().body("sessionId is required");
        }

        return ResponseEntity.ok(fileService.saveFile(sessionId, path, content));
    }

    // Flat endpoint for single file delete
    @DeleteMapping("/delete-file")
    public ResponseEntity<?> deleteFile(@RequestParam String sessionId, @RequestParam String path) {
        fileService.deleteFileRecursive(sessionId, path);
        return ResponseEntity.ok().build();
    }

    /**
     * Mark a session as still in use.
     *
     * The client calls this on launch for the session it is restoring, which is
     * what keeps the retention sweep from collecting a session someone is still
     * working in — including, importantly, one whose files have not yet been
     * migrated to disk.
     */
    @PostMapping("/{id}/touch")
    public ResponseEntity<Map<String, Object>> touchSession(@PathVariable String id) {
        return sessionRepository.findById(id)
                .map(session -> {
                    session.touch();
                    sessionRepository.save(session);
                    return ResponseEntity.ok(Map.<String, Object>of("ok", true));
                })
                .orElseGet(() -> ResponseEntity.status(404)
                        .body(Map.<String, Object>of("message", "Session not found")));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Session> getSession(@PathVariable String id) {
        return sessionRepository.findById(id)
                .map(session -> {
                    // Looking a session up is itself a sign of life.
                    session.touch();
                    return ResponseEntity.ok(sessionRepository.save(session));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/{id}/files")
    public ResponseEntity<?> getSessionFiles(@PathVariable String id) {
        if (id == null || id.trim().isEmpty() || "null".equals(id) || "undefined".equals(id)) {
            return ResponseEntity.badRequest().body(Map.of("message", "Invalid Session ID"));
        }
        if (!sessionRepository.existsById(id)) {
            return ResponseEntity.status(404).body(Map.of("message", "Session not found"));
        }
        List<Map<String, String>> files = fileService.getFilesForSession(id);
        return ResponseEntity.ok(files);
    }
}
