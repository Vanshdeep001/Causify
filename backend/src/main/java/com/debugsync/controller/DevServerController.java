/*
 * DevServerController.java — REST endpoints for dev server management
 * 
 * Endpoints:
 *   POST /api/devserver/detect  — Detect project types
 *   POST /api/devserver/start   — Start a dev server
 *   POST /api/devserver/stop    — Stop a running server
 *   GET  /api/devserver/status  — Get all servers status
 *   GET  /api/devserver/logs    — Get logs for a server
 */
package com.debugsync.controller;

import com.debugsync.dto.DevServerDto.*;
import com.debugsync.service.DevServerService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/devserver")
public class DevServerController {

    private final DevServerService devServerService;

    public DevServerController(DevServerService devServerService) {
        this.devServerService = devServerService;
    }

    @PostMapping("/detect")
    public ResponseEntity<DetectionResult> detectProject(@RequestBody DetectRequest request) {
        DetectionResult result = devServerService.detectProjects(request.getSessionId());
        return ResponseEntity.ok(result);
    }

    @PostMapping("/start")
    public ResponseEntity<ServerStatus> startServer(@RequestBody ServerActionRequest request) {
        ServerStatus status = devServerService.startServer(
            request.getSessionId(),
            request.getDirectory(),
            request.getType()
        );
        return ResponseEntity.ok(status);
    }

    @PostMapping("/stop")
    public ResponseEntity<ServerStatus> stopServer(@RequestBody ServerActionRequest request) {
        ServerStatus status = devServerService.stopServer(
            request.getSessionId(),
            request.getType()
        );
        return ResponseEntity.ok(status);
    }

    @GetMapping("/status")
    public ResponseEntity<AllServersStatus> getStatus(@RequestParam String sessionId) {
        AllServersStatus status = devServerService.getStatus(sessionId);
        return ResponseEntity.ok(status);
    }

    @GetMapping("/logs")
    public ResponseEntity<Map<String, List<String>>> getLogs(
            @RequestParam String sessionId,
            @RequestParam String type) {
        List<String> logs = devServerService.getLogs(sessionId, type);
        return ResponseEntity.ok(Map.of("logs", logs));
    }
}
