/*
 * LlmProvider.java — One LLM vendor, behind a uniform interface.
 *
 * Everything above this (root-cause analysis, the auto-fix agent) asks a single
 * question: "given this prompt, give me text back". Which vendor answers is a
 * configuration detail, so it lives here and nowhere else.
 *
 * Providers are plain objects, not Spring beans — they hold no state beyond
 * their own constants, and the key is passed in on every call. That is what
 * lets a user swap providers at runtime without anything being re-wired.
 */
package com.debugsync.ai;

public interface LlmProvider {

    /** Stable identifier used in config and on the wire. */
    String id();

    /** Name shown to the user. */
    String displayName();

    /** Model used when the user does not name one. */
    String defaultModel();

    /** Where the user gets a key. */
    String consoleUrl();

    /** Placeholder shown in the key field, so the expected shape is obvious. */
    String keyHint();

    /**
     * Whether a pasted key looks like this provider's.
     *
     * Used only to pre-select the provider for the user — never to reject a
     * key. Formats change, and a user who explicitly picks a provider is
     * always obeyed over this guess.
     */
    boolean looksLikeMyKey(String key);

    /**
     * Send a prompt, return the model's reply.
     *
     * @param model null or blank to use {@link #defaultModel()}
     * @return the reply text, or null when the model returned nothing usable
     * @throws Exception with a user-facing message when the call fails
     */
    String complete(String apiKey, String model, String prompt, int maxTokens, double temperature) throws Exception;

    /**
     * Verify a key by making a real, minimal generation call.
     *
     * Deliberately not a call to a models-list endpoint: listing is free and
     * succeeds on keys that cannot generate at all, which makes a broken key
     * look healthy right up until the first real request.
     *
     * @return null when the key works, otherwise a short reason it does not
     */
    default String testKey(String apiKey, String model) {
        try {
            // Budget is generous because reasoning models spend part of it
            // thinking; too small a value returns an empty reply that would
            // read as a rejected key.
            String reply = complete(apiKey, model, "Reply with exactly: OK", 1000, 0.0);
            return reply == null ? "The model returned an empty response." : null;
        } catch (Exception e) {
            return e.getMessage();
        }
    }
}
