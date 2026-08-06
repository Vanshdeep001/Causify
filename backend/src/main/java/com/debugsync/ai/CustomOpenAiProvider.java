/*
 * CustomOpenAiProvider.java — Any OpenAI-compatible endpoint the user names.
 *
 * This is what makes the feature genuinely unrestricted rather than "four
 * vendors we happened to implement". Together, Fireworks, DeepInfra, Cerebras,
 * Nebius, a self-hosted vLLM, Ollama or LM Studio on localhost — all of them
 * speak /chat/completions, so all of them work by pasting a base URL.
 *
 * Unlike the other providers this one carries state (its URL), so the registry
 * builds a fresh instance per configuration rather than sharing a singleton.
 */
package com.debugsync.ai;

public class CustomOpenAiProvider extends OpenAiCompatibleProvider {

    public static final String ID = "custom";

    private final String baseUrl;

    public CustomOpenAiProvider(String baseUrl) {
        this.baseUrl = normalise(baseUrl);
    }

    /**
     * People paste what they see in the docs, which is rarely the exact string
     * needed. Accept the common shapes rather than failing on a trailing slash.
     */
    private static String normalise(String url) {
        if (url == null || url.isBlank()) return "";
        String u = url.trim();
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        // Both "…/v1" and "…/v1/chat/completions" are things people copy.
        if (u.endsWith("/chat/completions")) u = u.substring(0, u.length() - "/chat/completions".length());
        return u;
    }

    @Override public String id() { return ID; }
    @Override public String displayName() { return "Custom (OpenAI-compatible)"; }
    @Override public String defaultModel() { return ""; }
    @Override public String consoleUrl() { return ""; }
    @Override public String keyHint() { return "any key your endpoint expects"; }
    @Override protected String baseUrl() { return baseUrl; }

    /** Never guessed from a key — the user has to choose this one explicitly. */
    @Override
    public boolean looksLikeMyKey(String key) {
        return false;
    }

    @Override
    public String complete(String apiKey, String model, String prompt, int maxTokens, double temperature)
            throws Exception {
        if (baseUrl.isBlank()) {
            throw new LlmException("This provider needs a base URL, e.g. https://api.together.xyz/v1");
        }
        if (model == null || model.isBlank()) {
            throw new LlmException("This provider needs a model name — there is no sensible default for a custom endpoint.");
        }
        return super.complete(apiKey, model, prompt, maxTokens, temperature);
    }
}
