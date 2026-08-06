/*
 * GroqProvider.java — Very fast inference on open-weight models.
 */
package com.debugsync.ai;

public class GroqProvider extends OpenAiCompatibleProvider {

    @Override public String id() { return "groq"; }
    @Override public String displayName() { return "Groq"; }
    @Override public String defaultModel() { return "llama-3.3-70b-versatile"; }
    @Override public String consoleUrl() { return "https://console.groq.com/keys"; }
    @Override public String keyHint() { return "gsk_…"; }
    @Override protected String baseUrl() { return "https://api.groq.com/openai/v1"; }

    @Override
    public boolean looksLikeMyKey(String key) {
        return key != null && key.startsWith("gsk_");
    }
}
