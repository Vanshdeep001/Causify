/*
 * OpenAiProvider.java — OpenAI direct.
 *
 * Included because it is the same wire format as the others and costs nothing
 * to support; a user with an OpenAI key should not be told to go and get a
 * different one.
 */
package com.debugsync.ai;

public class OpenAiProvider extends OpenAiCompatibleProvider {

    @Override public String id() { return "openai"; }
    @Override public String displayName() { return "OpenAI"; }
    @Override public String defaultModel() { return "gpt-4o-mini"; }
    @Override public String consoleUrl() { return "https://platform.openai.com/api-keys"; }
    @Override public String keyHint() { return "sk-…"; }
    @Override protected String baseUrl() { return "https://api.openai.com/v1"; }

    /**
     * Checked last of the "sk-" family. OpenRouter keys also begin with "sk-",
     * so this deliberately excludes that prefix rather than claiming every key
     * that starts with two letters and a dash.
     */
    @Override
    public boolean looksLikeMyKey(String key) {
        return key != null && key.startsWith("sk-") && !key.startsWith("sk-or-");
    }
}
