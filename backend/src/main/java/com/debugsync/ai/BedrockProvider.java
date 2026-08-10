/*
 * BedrockProvider.java — AWS Bedrock via the Converse API.
 *
 * Auth is a Bedrock API key sent as a bearer token, so there is no SigV4
 * signing and no AWS SDK dependency.
 *
 * Bedrock is the one provider that needs a region as well as a key, and the
 * model id is region-specific — some areas require a cross-region inference
 * profile id ("us."/"apac." prefixed) rather than the bare one. The region is
 * therefore part of the model field: "us-west-2/openai.gpt-oss-120b-1:0". That
 * keeps one text box in the UI instead of adding a field every other provider
 * would have to ignore.
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

public class BedrockProvider implements LlmProvider {

    private static final String DEFAULT_REGION = "us-west-2";

    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    @Override public String id() { return "bedrock"; }
    @Override public String displayName() { return "AWS Bedrock"; }
    @Override public String defaultModel() { return DEFAULT_REGION + "/openai.gpt-oss-120b-1:0"; }
    @Override public String consoleUrl() { return "https://console.aws.amazon.com/bedrock/home#/api-keys"; }
    @Override public String keyHint() { return "ABSK…  (model: region/model-id)"; }

    @Override
    public boolean looksLikeMyKey(String key) {
        return key != null && key.startsWith("ABSK");
    }

    /** Splits "us-west-2/model-id" into its two halves, falling back sensibly. */
    private String[] splitModel(String model) {
        String value = (model == null || model.isBlank()) ? defaultModel() : model;
        int slash = value.indexOf('/');
        // A bare model id with no region prefix still works — it just uses the
        // default region rather than failing on a missing field.
        if (slash <= 0) return new String[] { DEFAULT_REGION, value };
        return new String[] { value.substring(0, slash), value.substring(slash + 1) };
    }

    @Override
    public String complete(String apiKey, String model, String prompt, int maxTokens, double temperature)
            throws Exception {

        String[] parts = splitModel(model);
        String region = parts[0];
        String modelId = parts[1];

        ObjectNode textBlock = mapper.createObjectNode();
        textBlock.put("text", prompt);
        ArrayNode content = mapper.createArrayNode();
        content.add(textBlock);

        ObjectNode message = mapper.createObjectNode();
        message.put("role", "user");
        message.set("content", content);
        ArrayNode messages = mapper.createArrayNode();
        messages.add(message);

        ObjectNode inferenceConfig = mapper.createObjectNode();
        inferenceConfig.put("maxTokens", maxTokens);
        inferenceConfig.put("temperature", temperature);

        ObjectNode body = mapper.createObjectNode();
        body.set("messages", messages);
        body.set("inferenceConfig", inferenceConfig);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://bedrock-runtime." + region + ".amazonaws.com/model/" + modelId + "/converse"))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
                .timeout(Duration.ofSeconds(90))
                .build();

        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new LlmException(describeFailure(response.statusCode(), response.body(), region, modelId));
        }

        JsonNode blocks = mapper.readTree(response.body()).path("output").path("message").path("content");
        if (!blocks.isArray() || blocks.isEmpty()) return null;

        // Reasoning models return their thinking as separate blocks; only the
        // text ones are the answer.
        StringBuilder sb = new StringBuilder();
        for (JsonNode block : blocks) {
            JsonNode text = block.get("text");
            if (text != null && !text.isNull()) sb.append(text.asText());
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    private String describeFailure(int status, String body, String region, String modelId) {
        String detail = body == null ? "" : body;
        if (status == 401 || status == 403) {
            return "Bedrock rejected this key (" + status + "). Short-term Bedrock keys expire — "
                    + "generate a fresh one and paste it again.";
        }
        if (detail.contains("Operation not allowed")) {
            return "Bedrock accepted the key but will not run inference. This usually means the AWS account "
                    + "is not enabled for billable services — check the account plan in AWS Billing.";
        }
        if (status == 404 || detail.contains("ResourceNotFound")) {
            return "Bedrock has no model '" + modelId + "' in " + region + ". Try another region, "
                    + "or use the cross-region inference profile id for your area.";
        }
        if (detail.contains("model identifier is invalid")) {
            return "'" + modelId + "' is not a valid Bedrock model id.";
        }
        if (status == 429) return "Bedrock is rate-limiting this key.";
        return "Bedrock returned status " + status + ".";
    }
}
