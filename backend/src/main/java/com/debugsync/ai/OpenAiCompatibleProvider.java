/*
 * OpenAiCompatibleProvider.java — Base for anything speaking OpenAI's
 * /chat/completions shape.
 *
 * That covers most of the market: OpenRouter, Groq, OpenAI itself, Together,
 * Fireworks, DeepInfra, Ollama, vLLM, LM Studio. Subclasses supply a base URL
 * and a name; the wire format is identical, so it is written once here.
 */
package com.debugsync.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public abstract class OpenAiCompatibleProvider implements LlmProvider {

    protected static final ObjectMapper MAPPER = new ObjectMapper();
    protected static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    /** e.g. "https://openrouter.ai/api/v1" — no trailing slash. */
    protected abstract String baseUrl();

    /** Extra headers a particular vendor wants (OpenRouter asks for attribution). */
    protected Map<String, String> extraHeaders() {
        return Map.of();
    }

    /* ─────────────────────────────────────────────────────────
     * Finding a model that exists
     *
     * Every provider here ships with a hardcoded default model, and every one
     * of those is a fact with an expiry date — vendors retire models constantly
     * and Groq faster than most. When that happens the default 404s and the
     * user is told to fix a model id they never chose, for a key that is
     * perfectly good.
     *
     * So the default is treated as a preference rather than a promise: if it is
     * gone, ask the provider what it actually serves and take one of those.
     * ───────────────────────────────────────────────────────── */

    /** Model ids that exist but cannot answer a chat completion. */
    private static final List<String> NOT_CHAT = List.of(
            "whisper", "tts", "embed", "guard", "moderation", "rerank", "stt", "distil"
    );

    /**
     * Rough preference order, matched as substrings. Deliberately shallow: the
     * aim is a sane general-purpose model, not the best one, and a long ranking
     * table would be one more thing that goes stale.
     */
    private static final List<String> PREFERRED = List.of(
            "versatile", "instruct", "llama-3.3", "llama-3.1", "gpt-oss", "qwen", "mixtral", "gemma"
    );

    /** The ids this key can actually use right now, or empty if we cannot tell. */
    protected List<String> listModels(String apiKey) {
        try {
            HttpRequest.Builder req = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl() + "/models"))
                    .header("Authorization", "Bearer " + apiKey)
                    .GET()
                    .timeout(Duration.ofSeconds(20));
            extraHeaders().forEach(req::header);

            HttpResponse<String> res = HTTP.send(req.build(), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) return List.of();

            List<String> ids = new ArrayList<>();
            for (JsonNode node : MAPPER.readTree(res.body()).path("data")) {
                String id = node.path("id").asText("");
                if (!id.isBlank()) ids.add(id);
            }
            return ids;
        } catch (Exception e) {
            // Listing is a convenience; failing it just means no suggestion.
            return List.of();
        }
    }

    @Override
    public String suggestModel(String apiKey) {
        List<String> chat = new ArrayList<>();
        for (String id : listModels(apiKey)) {
            String lower = id.toLowerCase(Locale.ROOT);
            if (NOT_CHAT.stream().noneMatch(lower::contains)) chat.add(id);
        }
        if (chat.isEmpty()) return null;

        for (String want : PREFERRED) {
            for (String id : chat) {
                if (id.toLowerCase(Locale.ROOT).contains(want)) return id;
            }
        }
        return chat.get(0);
    }

    /**
     * Models that take {@code reasoning_effort}.
     *
     * The OpenAI-compatible equivalent of Gemini's thinking budget: gpt-oss
     * reasons before it answers, and on a short edit that reasoning is most of
     * the wall clock. Groq, which is where these are usually served, documents
     * the parameter for exactly this family.
     *
     * Matched narrowly on purpose. An unknown parameter is a 400 on some
     * gateways rather than a shrug, and a rejected request is far more
     * expensive than the reasoning pass it was trying to skip.
     */
    private static boolean supportsReasoningEffort(String modelId) {
        return modelId != null && modelId.toLowerCase(Locale.ROOT).contains("gpt-oss");
    }

    @Override
    public String complete(String apiKey, String model, String prompt, int maxTokens, double temperature)
            throws Exception {
        return complete(apiKey, model, prompt, maxTokens, temperature, false);
    }

    @Override
    public String complete(String apiKey, String model, String prompt, int maxTokens,
                           double temperature, boolean preferSpeed) throws Exception {

        boolean usingDefault = (model == null || model.isBlank());
        String resolvedModel = usingDefault ? defaultModel() : model;

        ObjectNode body = MAPPER.createObjectNode();
        body.put("model", resolvedModel);
        body.put("max_tokens", maxTokens);
        body.put("temperature", temperature);

        // Think less, answer sooner — only where the caller said latency matters
        // and only for a model family known to understand the request. Repairs
        // and retries never set this; see AutoFixService.requestPatch.
        if (preferSpeed && supportsReasoningEffort(resolvedModel)) {
            body.put("reasoning_effort", "low");
        }

        ObjectNode message = MAPPER.createObjectNode();
        message.put("role", "user");
        message.put("content", prompt);
        ArrayNode messages = MAPPER.createArrayNode();
        messages.add(message);
        body.set("messages", messages);

        HttpRequest.Builder req = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl() + "/chat/completions"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body)))
                .timeout(Duration.ofSeconds(90));
        extraHeaders().forEach(req::header);

        HttpResponse<String> response = HTTP.send(req.build(), HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() != 200) {
            throw new LlmException(describeFailure(
                    response.statusCode(), response.body(), resolvedModel, usingDefault));
        }

        JsonNode root = MAPPER.readTree(response.body());
        JsonNode choices = root.path("choices");
        if (!choices.isArray() || choices.isEmpty()) return null;

        JsonNode content = choices.get(0).path("message").path("content");
        if (content.isMissingNode() || content.isNull()) return null;

        String text = content.asText();
        return text.isBlank() ? null : text;
    }

    /**
     * Turns a status code into something the user can act on.
     *
     * @param model        the model actually sent, after defaulting
     * @param usingDefault true when the caller supplied no model, so this one is ours
     */
    protected String describeFailure(int status, String rawBody, String model, boolean usingDefault) {
        String detail = extractMessage(rawBody);
        return switch (status) {
            case 401 -> displayName() + " rejected this key. Check it was copied in full.";
            case 403 -> displayName() + " refused the request (403). The key may lack access to "
                    + "'" + model + "'.";
            /* 404 names the model and says whose choice it was.
             *
             * This branch used to read "No such model. Check the model id." and
             * throw `detail` away — which was the one case where the vendor's own
             * message identifies the offending model, and the one case where the
             * user most needs it. Worse, it told people to check a model id they
             * had usually never entered: when the field is left blank the id is
             * OUR default, so a provider retiring a model turned into advice to
             * go and fix something the user never touched. */
            case 404 -> usingDefault
                    ? "Causify's default model for " + displayName() + " ('" + model + "') is not "
                      + "available on this key — the provider has most likely retired it. Open "
                      + "Options and name a current model."
                      + (detail.isBlank() ? "" : " " + displayName() + " said: " + detail)
                    : "No model '" + model + "' on " + displayName() + "."
                      + (detail.isBlank() ? "" : " " + displayName() + " said: " + detail);
            case 429 -> displayName() + " is rate-limiting or out of quota"
                    + (detail.isBlank() ? "." : ": " + detail);
            case 402 -> displayName() + " reports insufficient credit for this request.";
            default -> displayName() + " returned status " + status + (detail.isBlank() ? "." : ": " + detail);
        };
    }

    /** Vendors bury the useful line at different depths; try the common ones. */
    protected String extractMessage(String rawBody) {
        if (rawBody == null || rawBody.isBlank()) return "";
        try {
            JsonNode root = MAPPER.readTree(rawBody);
            for (String path : new String[] { "/error/message", "/message", "/error" }) {
                JsonNode node = root.at(path);
                if (node.isTextual() && !node.asText().isBlank()) return trim(node.asText());
            }
        } catch (Exception ignored) {
            // Not JSON — fall through to the raw text.
        }
        return trim(rawBody);
    }

    protected static String trim(String s) {
        String t = s.trim().replaceAll("\\s+", " ");
        return t.length() <= 240 ? t : t.substring(0, 240) + "…";
    }
}
