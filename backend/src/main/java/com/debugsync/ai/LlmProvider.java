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
     * The same call, with a hint that latency matters more than deliberation.
     *
     * Reasoning models spend output tokens thinking before they write, and on a
     * chat-style model that is most of the wall clock: Gemini 2.5 Flash was
     * measured spending ~700 tokens reasoning before a ~120 token answer, on
     * every request. For a hard root-cause repair that is money well spent. For
     * "make the total red" it is the user watching a spinner for ten seconds
     * while the model considers a one-line change.
     *
     * Providers that can turn that off should override this. The default
     * ignores the hint entirely, so a provider only opts in when it has
     * something real to do with it — nothing changes for the others.
     *
     * @param preferSpeed true when the caller would rather have the answer now
     */
    default String complete(String apiKey, String model, String prompt, int maxTokens,
                            double temperature, boolean preferSpeed) throws Exception {
        return complete(apiKey, model, prompt, maxTokens, temperature);
    }

    /**
     * Verify a key by making a real, minimal generation call.
     *
     * Deliberately not a call to a models-list endpoint: listing is free and
     * succeeds on keys that cannot generate at all, which makes a broken key
     * look healthy right up until the first real request.
     *
     * @return null when the key works, otherwise a short reason it does not
     */
    /**
     * A model id this key can actually use, when the built-in default cannot.
     *
     * Providers retire models, so {@link #defaultModel()} is a preference with
     * an expiry date rather than a guarantee. Implementations that can enumerate
     * what a key serves should do so here; returning null simply means no
     * suggestion is available and the caller reports the original failure.
     */
    default String suggestModel(String apiKey) {
        return null;
    }

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
