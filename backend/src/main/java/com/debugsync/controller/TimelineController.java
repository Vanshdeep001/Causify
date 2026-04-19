/*
 * TimelineController.java — REST endpoints for the debug timeline
 */
package com.debugsync.controller;

import com.debugsync.model.CodeSnapshot;
import com.debugsync.service.TimelineService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/timeline")
public class TimelineController {

    private final TimelineService timelineService;

    public TimelineController(TimelineService timelineService) {
        this.timelineService = timelineService;
    }

    @GetMapping("/{sessionId}")
    public ResponseEntity<?> getTimeline(@PathVariable String sessionId) {
        if (sessionId == null || sessionId.trim().isEmpty() || "null".equals(sessionId) || "undefined".equals(sessionId)) {
            return ResponseEntity.badRequest().body(Map.of("message", "Invalid Session ID"));
        }
        List<CodeSnapshot> snapshots = timelineService.getTimeline(sessionId);
        Map<String, Object> response = new HashMap<>();
        response.put("sessionId", sessionId);
        response.put("snapshots", snapshots);
        response.put("count", snapshots.size());
        return ResponseEntity.ok(response);
    }

    @PostMapping("/snapshot")
    public ResponseEntity<CodeSnapshot> createSnapshot(@RequestBody Map<String, String> body) {
        String sessionId = body.get("sessionId");
        String code = body.get("code");
        String userId = body.getOrDefault("userId", "system");
        return ResponseEntity.ok(timelineService.createSnapshot(sessionId, code, userId, "", false));
    }
}
