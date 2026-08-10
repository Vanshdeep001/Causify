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

    @Override
    public String complete(String apiKey, String model, String prompt, int maxTokens, double temperature)
            throws Exception {

        ObjectNode body = MAPPER.createObjectNode();
        body.put("model", (model == null || model.isBlank()) ? defaultModel() : model);
        body.put("max_tokens", maxTokens);
        body.put("temperature", temperature);

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
            throw new LlmException(describeFailure(response.statusCode(), response.body()));
        }

        JsonNode root = MAPPER.readTree(response.body());
        JsonNode choices = root.path("choices");
        if (!choices.isArray() || choices.isEmpty()) return null;

        JsonNode content = choices.get(0).path("message").path("content");
        if (content.isMissingNode() || content.isNull()) return null;

        String text = content.asText();
        return text.isBlank() ? null : text;
    }

    /** Turns a status code into something the user can act on. */
    protected String describeFailure(int status, String rawBody) {
        String detail = extractMessage(rawBody);
        return switch (status) {
            case 401 -> displayName() + " rejected this key. Check it was copied in full.";
            case 403 -> displayName() + " refused the request (403). The key may lack access to this model.";
            case 404 -> "No such model on " + displayName() + ". Check the model id.";
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
