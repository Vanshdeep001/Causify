package com.debugsync.controller;

import com.debugsync.model.Session;
import com.debugsync.repository.SessionRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/whiteboard")
public class WhiteboardController {

    private final SessionRepository sessionRepository;

    public WhiteboardController(SessionRepository sessionRepository) {
        this.sessionRepository = sessionRepository;
    }

    @GetMapping
    public ResponseEntity<?> getWhiteboard(@RequestParam String projectId) {
        if (projectId == null || projectId.trim().isEmpty() || "null".equals(projectId) || "undefined".equals(projectId)) {
            return ResponseEntity.badRequest().body(Map.of("message", "Invalid Project ID"));
        }
        Optional<Session> sessionOpt = sessionRepository.findById(projectId);
        if (sessionOpt.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("message", "Session not found"));
        }
        Session session = sessionOpt.get();
        String boardData = session.getWhiteboardData();
        if (boardData == null || boardData.trim().isEmpty()) {
            return ResponseEntity.ok("[]");
        }
        // Since boardData is already JSON text, we return it directly. 
        // We'll set the Content-Type header to application/json to make sure the client parses it correctly.
        return ResponseEntity.ok()
                .header("Content-Type", "application/json")
                .body(boardData);
    }

    @PutMapping
    public ResponseEntity<?> saveWhiteboard(@RequestParam String projectId, @RequestBody String boardData) {
        if (projectId == null || projectId.trim().isEmpty() || "null".equals(projectId) || "undefined".equals(projectId)) {
            return ResponseEntity.badRequest().body(Map.of("message", "Invalid Project ID"));
        }
        Optional<Session> sessionOpt = sessionRepository.findById(projectId);
        if (sessionOpt.isEmpty()) {
            return ResponseEntity.status(404).body(Map.of("message", "Session not found"));
        }
        Session session = sessionOpt.get();
        session.setWhiteboardData(boardData);
        sessionRepository.save(session);
        return ResponseEntity.ok(Map.of("success", true));
    }
}
