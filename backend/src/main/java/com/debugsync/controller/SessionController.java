/*
 * SessionController.java — REST endpoints for session management
 */
package com.debugsync.controller;

import com.debugsync.model.Session;
import com.debugsync.repository.SessionRepository;
import com.debugsync.service.FileService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/session")
public class SessionController {

    private final SessionRepository sessionRepository;
    private final FileService fileService;

    public SessionController(SessionRepository sessionRepository, FileService fileService) {
        this.sessionRepository = sessionRepository;
        this.fileService = fileService;
    }

    @PostMapping("/create")
    public ResponseEntity<Map<String, String>> createSession(@RequestBody Map<String, String> body) {
        String name = body.getOrDefault("name", "Debug Session");
        String password = body.get("password");

        Session session = new Session();
        session.setName(name);
        session.setPassword(password);
        session.setCurrentCode("");
        session = sessionRepository.save(session);

        String userId = UUID.randomUUID().toString().substring(0, 8);

        Map<String, String> response = new HashMap<>();
        response.put("id", session.getId());
        response.put("name", session.getName());
        response.put("userId", userId);
        response.put("role", "owner");

        return ResponseEntity.ok(response);
    }

    @PostMapping("/join")
    public ResponseEntity<?> joinSession(@RequestBody Map<String, String> body) {
        String id = body.get("id");
        String password = body.get("password");

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

        return ResponseEntity.ok(response);
    }

    // Flat endpoint for bulk upload
    @PostMapping("/upload")
    public ResponseEntity<?> uploadProject(@RequestParam String sessionId, @RequestBody List<Map<String, String>> files) {
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

    @GetMapping("/{id}")
    public ResponseEntity<Session> getSession(@PathVariable String id) {
        return sessionRepository.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }
    @GetMapping("/{id}/files")
    public ResponseEntity<?> getSessionFiles(@PathVariable String id) {
        if (!sessionRepository.existsById(id)) {
            return ResponseEntity.status(404).body(Map.of("message", "Session not found"));
        }
        List<Map<String, String>> files = fileService.getFilesForSession(id);
        return ResponseEntity.ok(files);
    }
}
