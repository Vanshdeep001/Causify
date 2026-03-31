/*
 * SessionController.java — REST endpoints for session management
 */
package com.debugsync.controller;

import com.debugsync.model.Session;
import com.debugsync.repository.SessionRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/session")
public class SessionController {

    private final SessionRepository sessionRepository;
    private final com.debugsync.repository.ProjectFileRepository projectFileRepository;

    public SessionController(SessionRepository sessionRepository, com.debugsync.repository.ProjectFileRepository projectFileRepository) {
        this.sessionRepository = sessionRepository;
        this.projectFileRepository = projectFileRepository;
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

        List<com.debugsync.model.ProjectFile> files = projectFileRepository.findBySessionId(id);
        String userId = UUID.randomUUID().toString().substring(0, 8);

        Map<String, Object> response = new HashMap<>();
        response.put("id", session.getId());
        response.put("name", session.getName());
        response.put("userId", userId);
        response.put("role", "collaborator");
        response.put("files", files);

        return ResponseEntity.ok(response);
    }

    @PostMapping("/{sessionId}/upload")
    public ResponseEntity<?> uploadProject(@PathVariable String sessionId, @RequestBody List<Map<String, String>> files) {
        if (!sessionRepository.existsById(sessionId)) {
            return ResponseEntity.status(404).body("Session not found");
        }

        List<com.debugsync.model.ProjectFile> savedFiles = new ArrayList<>();
        for (Map<String, String> fileData : files) {
            String path = fileData.get("path");
            String content = fileData.get("content");
            
            com.debugsync.model.ProjectFile projectFile = projectFileRepository
                .findBySessionIdAndPath(sessionId, path)
                .orElse(new com.debugsync.model.ProjectFile(sessionId, path, content));
            
            projectFile.setContent(content);
            savedFiles.add(projectFileRepository.save(projectFile));
        }

        return ResponseEntity.ok(savedFiles);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Session> getSession(@PathVariable String id) {
        return sessionRepository.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }
}
