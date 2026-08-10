/*
 * AiConfigController.java — Runtime configuration of the AI engine
 *
 * Lets the frontend discover which providers exist, check whether one is
 * configured, and supply a key at runtime — verified with a real generation
 * call before activation, so a key that cannot actually generate is rejected
 * here rather than silently failing on the first real request.
 *
 * This is the primary way credentials get set, not a convenience: it keeps them
 * out of application.yml, and therefore out of git.
 */
package com.debugsync.controller;

import com.debugsync.ai.CustomOpenAiProvider;
import com.debugsync.ai.LlmProvider;
import com.debugsync.ai.ProviderRegistry;
import com.debugsync.service.AiAnalysisService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/ai")
public class AiConfigController {

    private final AiAnalysisService aiAnalysisService;
    private final ProviderRegistry registry;

    public AiConfigController(AiAnalysisService aiAnalysisService, ProviderRegistry registry) {
        this.aiAnalysisService = aiAnalysisService;
        this.registry = registry;
    }

    /** Everything the key form needs to render itself. */
    @GetMapping("/providers")
    public ResponseEntity<Map<String, Object>> providers() {
        List<Map<String, Object>> list = new ArrayList<>();
        for (LlmProvider p : registry.all()) {
            list.add(describe(p, false));
        }
        // The catch-all is offered last: it is the answer for anything not
        // named above, and it needs a base URL the others do not.
        list.add(describe(new CustomOpenAiProvider(""), true));
        return ResponseEntity.ok(Map.of("providers", list));
    }

    private Map<String, Object> describe(LlmProvider p, boolean needsBaseUrl) {
        Map<String, Object> m = new HashMap<>();
        m.put("id", p.id());
        m.put("name", p.displayName());
        m.put("defaultModel", p.defaultModel());
        m.put("consoleUrl", p.consoleUrl());
        m.put("keyHint", p.keyHint());
        m.put("needsBaseUrl", needsBaseUrl);
        return m;
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status() {
        Map<String, Object> body = new HashMap<>();
        body.put("configured", aiAnalysisService.isConfigured());
        LlmProvider active = aiAnalysisService.activeProvider();
        body.put("provider", active != null ? active.id() : null);
        body.put("providerName", active != null ? active.displayName() : null);
        body.put("model", aiAnalysisService.activeModel());
        return ResponseEntity.ok(body);
    }

    /**
     * Guess the provider from a pasted key so the form can pre-select it.
     * Purely advisory — an unrecognised key is not an error, it just means the
     * user picks from the list themselves.
     */
    @PostMapping("/detect")
    public ResponseEntity<Map<String, Object>> detect(@RequestBody Map<String, String> body) {
        LlmProvider p = registry.detect(body.getOrDefault("key", ""));
        Map<String, Object> out = new HashMap<>();
        out.put("provider", p != null ? p.id() : null);
        out.put("providerName", p != null ? p.displayName() : null);
        out.put("defaultModel", p != null ? p.defaultModel() : null);
        return ResponseEntity.ok(out);
    }

    /**
     * Forget the active key.
     *
     * The desktop app keeps its own encrypted copy in the OS keychain and
     * clears that separately — this only drops what the running server holds.
     */
    @DeleteMapping("/key")
    public ResponseEntity<Map<String, Object>> clearKey() {
        aiAnalysisService.clearConfig();
        return ResponseEntity.ok(Map.of("success", true));
    }

    @PostMapping("/key")
    public ResponseEntity<Map<String, Object>> setKey(@RequestBody Map<String, String> body) {
        String key = body.getOrDefault("key", "").trim();
        String provider = body.getOrDefault("provider", "").trim();
        String model = body.getOrDefault("model", "").trim();
        String baseUrl = body.getOrDefault("baseUrl", "").trim();

        if (key.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "No key provided."));
        }

        String error = aiAnalysisService.testConfig(key, provider, model, baseUrl);
        if (error != null) {
            return ResponseEntity.ok(Map.of("success", false, "error", error));
        }

        aiAnalysisService.updateConfig(key, provider, model, baseUrl);

        LlmProvider active = aiAnalysisService.activeProvider();
        Map<String, Object> out = new HashMap<>();
        out.put("success", true);
        out.put("provider", active != null ? active.id() : provider);
        out.put("providerName", active != null ? active.displayName() : provider);
        out.put("model", aiAnalysisService.activeModel());
        return ResponseEntity.ok(out);
    }
}
