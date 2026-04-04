package com.debugsync.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Map;

@RestController
@RequestMapping("/api/git")
@CrossOrigin(origins = "*")
public class GitController {

    private static final Logger log = LoggerFactory.getLogger(GitController.class);

    /**
     * Simulates performing a git commit
     * Expected JSON body: { message: "...", files: ["...", "..."] }
     */
    @PostMapping("/commit")
    public ResponseEntity<?> performCommit(@RequestBody Map<String, Object> payload) {
        String message = (String) payload.get("message");
        Object files = payload.get("files");
        
        log.info("[GitAssistant] Generated Commit Approved: '{}'", message);
        log.info("[GitAssistant] Staged Files: {}", files);
        
        // In a real environment, this would initialize a repository
        // and execute 'git commit' via ProcessBuilder.
        // For DebugSync's collaborative stateless nature, we log it.
        
        return ResponseEntity.ok(Map.of(
            "status", "success",
            "message", "Commit successful: " + message,
            "hash", String.format("%07x", (int) (Math.random() * 0xFFFFFFF))
        ));
    }
}
