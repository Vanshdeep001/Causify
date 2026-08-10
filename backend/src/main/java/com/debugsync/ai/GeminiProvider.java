/*
 * GeminiProvider.java — Google Gemini, native generateContent API.
 *
 * Not routed through the OpenAI-compatible base because Gemini's own format is
 * the better-supported path, and its 2.5 models have a failure mode the generic
 * client cannot see: thinking tokens are drawn from the SAME output budget as
 * the reply, so an undersized budget returns a candidate with no text at all
 * rather than an error. Measured here: ~700 thinking tokens before a ~120 token
 * answer. That case is detected and reported instead of surfacing as silence.
 */
package com.debugsync.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class GeminiProvider implements LlmProvider {

    private static final Logger log = LoggerFactory.getLogger(GeminiProvider.class);
    private static final String BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    @Override public String id() { return "gemini"; }
    @Override public String displayName() { return "Google Gemini"; }
    /* Flash rather than Pro: free-tier keys commonly have gemini-2.5-pro capped
     * at zero requests, which returns a 429 that reads like rate limiting. */
    @Override public String defaultModel() { return "gemini-2.5-flash"; }
    @Override public String consoleUrl() { return "https://aistudio.google.com/apikey"; }
    @Override public String keyHint() { return "AIza… or AQ.…"; }

    @Override
    public boolean looksLikeMyKey(String key) {
        return key != null && (key.startsWith("AIza") || key.startsWith("AQ."));
    }

    @Override
    public String complete(String apiKey, String model, String prompt, int maxTokens, double temperature)
            throws Exception {

        String modelId = (model == null || model.isBlank()) ? defaultModel() : model;

        ObjectNode part = mapper.createObjectNode();
        part.put("text", prompt);
        ArrayNode parts = mapper.createArrayNode();
        parts.add(part);

        ObjectNode turn = mapper.createObjectNode();
        turn.set("parts", parts);
        ArrayNode contents = mapper.createArrayNode();
        contents.add(turn);

        ObjectNode generationConfig = mapper.createObjectNode();
        generationConfig.put("maxOutputTokens", maxTokens);
        generationConfig.put("temperature", temperature);

        ObjectNode body = mapper.createObjectNode();
        body.set("contents", contents);
        body.set("generationConfig", generationConfig);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(BASE + modelId + ":generateContent"))
                .header("Content-Type", "application/json")
                // Header rather than ?key= — a key in a URL leaks into logs.
                .header("x-goog-api-key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                .timeout(Duration.ofSeconds(90))
                .build();

        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new LlmException(describeFailure(response.statusCode(), response.body(), modelId));
        }
        return extractText(response.body());
    }

    private String extractText(String json) throws Exception {
        JsonNode root = mapper.readTree(json);

        JsonNode candidates = root.path("candidates");
        if (!candidates.isArray() || candidates.isEmpty()) {
            String blocked = root.path("promptFeedback").path("blockReason").asText("");
            if (!blocked.isEmpty()) throw new LlmException("Gemini blocked the prompt (" + blocked + ").");
            return null;
        }

        JsonNode candidate = candidates.get(0);
        StringBuilder sb = new StringBuilder();
        for (JsonNode p : candidate.path("content").path("parts")) {
            JsonNode text = p.get("text");
            if (text != null && !text.isNull()) sb.append(text.asText());
        }

        if (sb.length() == 0) {
            if ("MAX_TOKENS".equals(candidate.path("finishReason").asText())) {
                int thoughts = root.path("usageMetadata").path("thoughtsTokenCount").asInt();
                log.warn("Gemini spent the whole budget thinking ({} tokens) and wrote nothing", thoughts);
                throw new LlmException("Gemini used its entire token budget on reasoning and returned no answer. "
                        + "Try a smaller prompt or a non-reasoning model.");
            }
            return null;
        }
        return sb.toString();
    }

    private String describeFailure(int status, String body, String modelId) {
        String detail = body == null ? "" : body;
        if (status == 400 && detail.contains("API_KEY_INVALID")) {
            return "Google rejected this key as invalid. Check it was copied in full.";
        }
        if (status == 401 || status == 403) {
            return "Google rejected this key (" + status + "). Make sure the Gemini API is enabled for it.";
        }
        if (status == 404) return "No Gemini model named '" + modelId + "'.";
        if (status == 429) {
            return "Quota exhausted for '" + modelId + "'. Some models are capped at zero on free-tier keys "
                    + "(gemini-2.5-pro often is) — try gemini-2.5-flash.";
        }
        return "Gemini returned status " + status + ".";
    }
}
