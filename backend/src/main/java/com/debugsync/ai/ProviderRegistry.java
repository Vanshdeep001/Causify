/*
 * ProviderRegistry.java — Which vendor is answering, and how it was chosen.
 *
 * Two jobs:
 *   - look a provider up by id
 *   - guess one from a pasted key, so the common case needs no dropdown
 *
 * The guess is a convenience, never a gate. An explicit choice always wins, and
 * a key that matches nothing is not rejected — it just means the user has to
 * say which provider it belongs to.
 */
package com.debugsync.ai;

import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ProviderRegistry {

    /* Order matters for detection: OpenAI's rule deliberately excludes the
     * "sk-or-" prefix, but keeping it last means a future overlap degrades to
     * "the more specific vendor wins" rather than a coin toss. */
    private final List<LlmProvider> providers = List.of(
            new OpenRouterProvider(),
            new GroqProvider(),
            new GeminiProvider(),
            new BedrockProvider(),
            new OpenAiProvider());

    /** Every provider the UI can offer, custom endpoint included. */
    public List<LlmProvider> all() {
        return providers;
    }

    /**
     * Resolve a configured provider.
     *
     * @param id      provider id; blank falls back to detection
     * @param key     used only when {@code id} is blank
     * @param baseUrl required for the custom provider, ignored otherwise
     */
    public LlmProvider resolve(String id, String key, String baseUrl) {
        if (CustomOpenAiProvider.ID.equals(id)) {
            return new CustomOpenAiProvider(baseUrl);
        }
        if (id != null && !id.isBlank()) {
            return providers.stream()
                    .filter(p -> p.id().equalsIgnoreCase(id))
                    .findFirst()
                    .orElseThrow(() -> new LlmException("Unknown AI provider '" + id + "'."));
        }
        LlmProvider detected = detect(key);
        if (detected == null) {
            throw new LlmException("Could not tell which provider this key belongs to. Pick one from the list.");
        }
        return detected;
    }

    /** @return the provider whose key format matches, or null when none does */
    public LlmProvider detect(String key) {
        if (key == null || key.isBlank()) return null;
        String trimmed = key.trim();
        return providers.stream()
                .filter(p -> p.looksLikeMyKey(trimmed))
                .findFirst()
                .orElse(null);
    }
}
