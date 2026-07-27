/*
 * SessionController.java — REST endpoints for session management
 */
package com.debugsync.controller;

import com.debugsync.model.Session;
import com.debugsync.repository.SessionRepository;
import com.debugsync.service.CollaborationService;
import com.debugsync.service.FileService;
import com.debugsync.service.SessionCleanupService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/session")
public class SessionController {

    private final SessionRepository sessionRepository;
    private final FileService fileService;
    private final CollaborationService collaborationService;
    private final SessionCleanupService sessionCleanupService;

    public SessionController(SessionRepository sessionRepository,
                             FileService fileService,
                             CollaborationService collaborationService,
                             SessionCleanupService sessionCleanupService) {
        this.sessionRepository = sessionRepository;
        this.fileService = fileService;
        this.collaborationService = collaborationService;
        this.sessionCleanupService = sessionCleanupService;
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

        boolean purged = remaining.isEmpty();
        if (purged) {
            sessionCleanupService.purgeSession(sessionId);
        }

        return ResponseEntity.ok(Map.of("purged", purged, "remainingUsers", remaining.size()));
    }

    @PostMapping("/create")
    public ResponseEntity<Map<String, Object>> createSession(@RequestBody Map<String, String> body) {
        String name = body.getOrDefault("name", "Debug Session");
        String username = body.getOrDefault("username", "Owner");
        String password = body.get("password");

        Session session = new Session();
        session.setName(name);
        session.setPassword(password);
        session.setCurrentCode("");
        session = sessionRepository.save(session);

        String userId = UUID.randomUUID().toString().substring(0, 8);

        Map<String, Object> response = new HashMap<>();
        response.put("id", session.getId());
        response.put("name", session.getName());
        response.put("userId", userId);
        response.put("role", "owner");
        // Full user object the client uses for presence + change attribution
        response.put("user", Map.of("id", userId, "username", username, "color", "#FF2E93"));

        return ResponseEntity.ok(response);
    }

    @PostMapping("/join")
    public ResponseEntity<?> joinSession(@RequestBody Map<String, String> body) {
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

        String userId = UUID.randomUUID().toString().substring(0, 8);

        // Load all project files so the collaborator gets the full file tree
        List<Map<String, String>> files = fileService.getFilesForSession(id);

        Map<String, Object> response = new HashMap<>();
        response.put("id", session.getId());
        response.put("name", session.getName());
        response.put("userId", userId);
        response.put("role", "collaborator");
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
