/*
 * GitController.java — REST endpoints for Git workspace operations
 *
 * All git commands are executed through GitWorkspaceService which
 * enforces sandboxing, whitelisting, and timeout protection.
 */
package com.debugsync.controller;

import com.debugsync.service.GitWorkspaceService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/git")
public class GitController {

    private static final Logger log = LoggerFactory.getLogger(GitController.class);

    private final GitWorkspaceService gitWorkspaceService;

    public GitController(GitWorkspaceService gitWorkspaceService) {
        this.gitWorkspaceService = gitWorkspaceService;
    }

    /**
     * Clone a repository into the session's sandboxed workspace.
     * Body: { "sessionId": "...", "repoUrl": "https://token@github.com/user/repo.git" }
     */
    @PostMapping("/clone")
    public ResponseEntity<?> cloneRepo(@RequestBody Map<String, String> payload) {
        try {
            String sessionId = payload.get("sessionId");
            String repoUrl = payload.get("repoUrl");

            // Log only safe URL (token stripped by service)
            log.info("[Git] Clone requested for session {}", sessionId);

            Map<String, Object> result = gitWorkspaceService.cloneRepo(sessionId, repoUrl);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", e.getMessage()));
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            log.error("[Git] Clone failed", e);
            return ResponseEntity.status(500).body(Map.of("success", false, "error", "Clone failed: " + e.getMessage()));
        }
    }

    /**
     * Stage all files and commit.
     * Body: { "sessionId": "...", "message": "fix: resolve null pointer" }
     */
    @PostMapping("/commit")
    public ResponseEntity<?> performCommit(@RequestBody Map<String, Object> payload) {
        try {
            String sessionId = (String) payload.get("sessionId");
            String message = (String) payload.get("message");
            List<Map<String, String>> files = (List<Map<String, String>>) payload.get("files");

            log.info("[Git] Commit requested for session {}: '{}'", sessionId, message);

            Map<String, Object> result = gitWorkspaceService.commitAll(sessionId, message, files);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", e.getMessage()));
        } catch (SecurityException e) {
            return ResponseEntity.status(403).body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            log.error("[Git] Commit failed", e);
            return ResponseEntity.status(500).body(Map.of("success", false, "error", "Commit failed: " + e.getMessage()));
        }
    }

    /**
     * Push to remote origin.
     * Body: { "sessionId": "..." }
     */
    @PostMapping("/push")
    public ResponseEntity<?> push(@RequestBody Map<String, String> payload) {
        try {
            String sessionId = payload.get("sessionId");
            log.info("[Git] Push requested for session {}", sessionId);

            Map<String, Object> result = gitWorkspaceService.push(sessionId);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            log.error("[Git] Push failed", e);
            return ResponseEntity.status(500).body(Map.of("success", false, "error", "Push failed: " + e.getMessage()));
        }
    }

    /**
     * Pull from remote origin.
     * Body: { "sessionId": "..." }
     */
    @PostMapping("/pull")
    public ResponseEntity<?> pull(@RequestBody Map<String, String> payload) {
        try {
            String sessionId = payload.get("sessionId");
            log.info("[Git] Pull requested for session {}", sessionId);

            Map<String, Object> result = gitWorkspaceService.pull(sessionId);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            log.error("[Git] Pull failed", e);
            return ResponseEntity.status(500).body(Map.of("success", false, "error", "Pull failed: " + e.getMessage()));
        }
    }

    /**
     * Get workspace git status.
     * Query: ?sessionId=...
     */
    @GetMapping("/status")
    public ResponseEntity<?> getStatus(@RequestParam String sessionId) {
        try {
            Map<String, Object> result = gitWorkspaceService.getStatus(sessionId);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            log.error("[Git] Status failed", e);
            return ResponseEntity.status(500).body(Map.of("success", false, "error", "Status failed: " + e.getMessage()));
        }
    }

    /**
     * Get recent commit log.
     * Query: ?sessionId=...&count=10
     */
    @GetMapping("/log")
    public ResponseEntity<?> getLog(@RequestParam String sessionId,
                                    @RequestParam(defaultValue = "10") int count) {
        try {
            Map<String, Object> result = gitWorkspaceService.getLog(sessionId, count);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            log.error("[Git] Log failed", e);
            return ResponseEntity.status(500).body(Map.of("success", false, "error", "Log failed: " + e.getMessage()));
        }
    }

    /**
     * Check if a repo is connected for this session.
     * Query: ?sessionId=...
     */
    @GetMapping("/connected")
    public ResponseEntity<?> isConnected(@RequestParam String sessionId) {
        try {
            boolean connected = gitWorkspaceService.isRepoConnected(sessionId);
            Map<String, Object> result = new HashMap<>();
            result.put("connected", connected);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("[Git] Connected check failed", e);
            Map<String, Object> result = new HashMap<>();
            result.put("connected", false);
            return ResponseEntity.ok(result);
        }
    }

    /**
     * Disconnect and clean up workspace.
     * Body: { "sessionId": "..." }
     */
    @PostMapping("/disconnect")
    public ResponseEntity<?> disconnect(@RequestBody Map<String, String> payload) {
        String sessionId = payload.get("sessionId");
        gitWorkspaceService.disconnectRepo(sessionId);
        return ResponseEntity.ok(Map.of("success", true, "message", "Repository disconnected"));
    }
}
