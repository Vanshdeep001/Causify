/*
 * ContextController.java — REST endpoint for project context
 *
 * Returns metadata about the current session: project ID,
 * active Git branch, and whether Git is connected.
 * Used by CodeShots to embed branch info in the metadata footer.
 */
package com.debugsync.controller;

import com.debugsync.service.GitWorkspaceService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/context")
public class ContextController {

    private static final Logger log = LoggerFactory.getLogger(ContextController.class);

    private final GitWorkspaceService gitWorkspaceService;

    public ContextController(GitWorkspaceService gitWorkspaceService) {
        this.gitWorkspaceService = gitWorkspaceService;
    }

    /**
     * Get project context metadata.
     * Query: ?projectId=...
     *
     * Returns:
     * {
     *   "projectId": "abc123",
     *   "branch": "main",
     *   "gitConnected": true
     * }
     */
    @GetMapping
    public ResponseEntity<?> getContext(@RequestParam String projectId) {
        try {
            Map<String, Object> result = new HashMap<>();
            result.put("projectId", projectId);

            boolean gitConnected = false;
            String branch = "—";

            try {
                gitConnected = gitWorkspaceService.isRepoConnected(projectId);
                if (gitConnected) {
                    // Attempt to extract branch from git status
                    Map<String, Object> statusResult = gitWorkspaceService.getStatus(projectId);
                    String statusOutput = (String) statusResult.get("output");
                    if (statusOutput != null) {
                        // Parse "On branch <name>" from git status output
                        for (String line : statusOutput.split("\n")) {
                            if (line.startsWith("On branch ")) {
                                branch = line.substring("On branch ".length()).trim();
                                break;
                            }
                        }
                    }
                }
            } catch (Exception e) {
                log.debug("[Context] Git info unavailable for session {}: {}", projectId, e.getMessage());
            }

            result.put("branch", branch);
            result.put("gitConnected", gitConnected);

            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("[Context] Failed to get context for {}", projectId, e);
            return ResponseEntity.status(500).body(
                Map.of("error", "Failed to get context: " + e.getMessage())
            );
        }
    }
}
