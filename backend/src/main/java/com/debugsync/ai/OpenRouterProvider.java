/*
 * OpenRouterProvider.java — One key, most models on the market.
 */
package com.debugsync.ai;

import java.util.Map;

public class OpenRouterProvider extends OpenAiCompatibleProvider {

    @Override public String id() { return "openrouter"; }
    @Override public String displayName() { return "OpenRouter"; }
    @Override public String defaultModel() { return "google/gemini-2.0-flash-001"; }
    @Override public String consoleUrl() { return "https://openrouter.ai/keys"; }
    @Override public String keyHint() { return "sk-or-v1-…"; }
    @Override protected String baseUrl() { return "https://openrouter.ai/api/v1"; }

    /** OpenRouter attributes usage to the calling app via these two headers. */
    @Override
    protected Map<String, String> extraHeaders() {
        return Map.of(
                "HTTP-Referer", "https://causify.dev",
                "X-Title", "Causify IDE");
    }

    @Override
    public boolean looksLikeMyKey(String key) {
        return key != null && key.startsWith("sk-or-");
    }
}
