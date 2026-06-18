/*
 * DeploymentController.java — REST endpoints for deployment history
 */
package com.debugsync.controller;

import com.debugsync.model.Deployment;
import com.debugsync.service.DeploymentService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/deployments")
public class DeploymentController {

    private final DeploymentService deploymentService;

    public DeploymentController(DeploymentService deploymentService) {
        this.deploymentService = deploymentService;
    }

    /**
     * Create a new deployment record.
     */
    @PostMapping
    public ResponseEntity<?> createDeployment(@RequestBody Deployment deployment) {
        if (deployment.getSessionId() == null || deployment.getSessionId().trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Session ID is required"));
        }
        if (deployment.getDeploymentUrl() == null || deployment.getDeploymentUrl().trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Deployment URL is required"));
        }
        Deployment saved = deploymentService.saveDeployment(deployment);
        return ResponseEntity.ok(saved);
    }

    /**
     * Get deployment history for a session.
     */
    @GetMapping
    public ResponseEntity<?> getDeployments(@RequestParam String sessionId) {
        if (sessionId == null || sessionId.trim().isEmpty() || "null".equals(sessionId) || "undefined".equals(sessionId)) {
            return ResponseEntity.badRequest().body(Map.of("message", "Invalid Session ID"));
        }
        List<Deployment> deployments = deploymentService.getDeploymentsBySession(sessionId);
        Map<String, Object> response = new HashMap<>();
        response.put("sessionId", sessionId);
        response.put("deployments", deployments);
        response.put("count", deployments.size());
        return ResponseEntity.ok(response);
    }
}
