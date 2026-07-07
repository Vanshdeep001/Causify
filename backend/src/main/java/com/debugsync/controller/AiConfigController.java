/*
 * AiConfigController.java — Runtime configuration of the AI diagnosis engine
 *
 * Lets the frontend check whether an OpenRouter key is configured and
 * supply one at runtime (verified against OpenRouter before activation),
 * so users can enable AI diagnosis directly from the terminal panel
 * without restarting the backend.
 */
package com.debugsync.controller;

import com.debugsync.service.AiAnalysisService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/ai")
public class AiConfigController {

    private final AiAnalysisService aiAnalysisService;

    public AiConfigController(AiAnalysisService aiAnalysisService) {
        this.aiAnalysisService = aiAnalysisService;
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status() {
        return ResponseEntity.ok(Map.of("configured", aiAnalysisService.isConfigured()));
    }

    @PostMapping("/key")
    public ResponseEntity<Map<String, Object>> setKey(@RequestBody Map<String, String> body) {
        String key = body.getOrDefault("key", "").trim();
        if (key.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "No key provided."));
        }

        String error = aiAnalysisService.testApiKey(key);
        if (error != null) {
            return ResponseEntity.ok(Map.of("success", false, "error", error));
        }

        aiAnalysisService.updateApiKey(key);
        return ResponseEntity.ok(Map.of("success", true));
    }
}
