/*
 * AiAnalysisService.java — AI-Powered Root Cause Analysis via Google Gemini
 *
 * Calls the Gemini generateContent API to produce:
 *   - A clear, creative explanation of WHY the error happened
 *   - A detailed breakdown of the root cause chain
 *   - Actionable suggested fixes with code examples
 *
 * Also the single LLM transport for the auto-fix agent (see AutoFixService),
 * which calls complete() directly.
 *
 * Auth is a Gemini API key sent in the x-goog-api-key header rather than the
 * ?key= query parameter Google also accepts — a key in a URL leaks into access
 * logs, proxies and crash reports; a header does not.
 *
 * The model id is configuration, not a constant: free-tier keys differ in what
 * they may call (gemini-2.5-pro is capped at zero requests on some, while
 * gemini-2.5-flash works), so switching must not need a rebuild.
 *
 * NOTE ON TOKEN BUDGETS — Gemini 2.5 models think before answering, and those
 * thinking tokens are drawn from the SAME maxOutputTokens allowance as the
 * reply. Measured here: ~700 thinking tokens before a ~120 token answer. A
 * budget sized only for the answer therefore returns finishReason=MAX_TOKENS
 * with no text at all, which would look like the model refusing rather than
 * running out of room. Every budget below is sized for thinking + answer.
 */
package com.debugsync.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

@Service
public class AiAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(AiAnalysisService.class);

    private static final String GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

    // Primary: GEMINI_API_KEY env var. Fallback: debugsync.ai.gemini-api-key in application.yml.
    // Can also be set at runtime via POST /api/ai/key (see AiConfigController).
    @Value("${GEMINI_API_KEY:${debugsync.ai.gemini-api-key:}}")
    private volatile String apiKey;

    @Value("${GEMINI_MODEL:${debugsync.ai.gemini-model:gemini-2.5-flash}}")
    private String modelId;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    /** Whether a Gemini key is currently available (env, yml, or set at runtime). */
    public boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank();
    }

    /** Replaces the active Gemini key at runtime (no restart needed). */
    public void updateApiKey(String key) {
        this.apiKey = key;
        log.info("Gemini API key updated at runtime (model={})", modelId);
    }

    /** The generateContent endpoint for the configured model. */
    private URI endpointUri() {
        return URI.create(GEMINI_BASE + modelId + ":generateContent");
    }

    /**
     * Verifies a key by making a real generation call.
     *
     * Deliberately NOT a call to the models-list endpoint. Listing is free and
     * succeeds on keys that cannot generate at all — the exact trap that made a
     * previously configured key look healthy while every real request failed.
     * Only generating proves the key can do the thing the app needs.
     *
     * The budget is generous because thinking tokens come out of it; too small
     * a value returns MAX_TOKENS with no text and would read as a broken key.
     *
     * @return null when the key works, otherwise a short description of why not
     */
    public String testApiKey(String key) {
        try {
            HttpResponse<String> response = send(key, buildRequestBody("Reply with exactly: OK", 1000, 0.0));
            int status = response.statusCode();
            if (status == 200) return null;
            return describeFailure(status, response.body());
        } catch (Exception e) {
            return "Could not reach Gemini: " + e.getMessage();
        }
    }

    /**
     * Turns a Gemini error into something a user can act on.
     *
     * A 429 is the one worth spelling out: on a free-tier key it usually means
     * the model is capped at zero requests rather than that the user is going
     * too fast, and the remedy is a different model, not waiting.
     */
    private String describeFailure(int status, String body) {
        String detail = body == null ? "" : body;
        if (status == 400 && detail.contains("API_KEY_INVALID")) {
            return "Google rejected this key as invalid. Check it was copied in full.";
        }
        if (status == 401 || status == 403) {
            return "Google rejected this key (" + status + "). Make sure the Gemini API is enabled for it.";
        }
        if (status == 404) {
            return "No model named '" + modelId + "'. Check the model id.";
        }
        if (status == 429) {
            return "Quota exhausted for '" + modelId + "'. Some models are capped at zero on free-tier keys "
                    + "(gemini-2.5-pro often is) — switch to gemini-2.5-flash, or wait for the quota to reset.";
        }
        return "Gemini returned status " + status + (detail.isBlank() ? "." : ": " + trimForMessage(detail));
    }

    private String trimForMessage(String s) {
        String t = s.trim().replaceAll("\\s+", " ");
        return t.length() <= 300 ? t : t.substring(0, 300) + "…";
    }

    /**
     * Generates an AI-powered root cause analysis for a given error.
     * Returns a structured analysis with explanation and suggested fix.
     */
    public AiAnalysisResult analyze(String errorType, String errorMessage, int errorLine,
                                     String suspectedVariable, String code, String language,
                                     java.util.Map<String, String> semContext) {
        if (apiKey == null || apiKey.isBlank()) {
            log.warn("Gemini API key not configured — skipping AI analysis");
            return null;
        }

        try {
            String prompt = buildPrompt(errorType, errorMessage, errorLine, suspectedVariable, code, language, semContext);
            // 3500, not 800: ~700 of it goes on thinking before a word is written.
            String response = callGemini(prompt, 3500, 0.4);
            return parseResponse(response);
        } catch (Exception e) {
            log.error("AI analysis failed: {}", e.getMessage());
            return null;
        }
    }

    private String buildPrompt(String errorType, String errorMessage, int errorLine,
                                String suspectedVariable, String code, String language,
                                java.util.Map<String, String> semContext) {
        StringBuilder sb = new StringBuilder();
        sb.append("You are an expert debugging assistant integrated into a collaborative IDE called Causify. ");
        sb.append("A user just ran their code and got an error. Analyze it and provide a CLEAR, CREATIVE root cause analysis.\n\n");

        sb.append("## Error Details\n");
        sb.append("- **Error Type:** ").append(errorType != null ? errorType : "Unknown").append("\n");
        sb.append("- **Error Message:** ").append(errorMessage != null ? errorMessage : "Unknown").append("\n");
        sb.append("- **Error Line:** ").append(errorLine).append("\n");
        if (suspectedVariable != null) {
            sb.append("- **Suspected Variable:** `").append(suspectedVariable).append("`\n");
        }
        sb.append("- **Language:** ").append(language != null ? language : "javascript").append("\n\n");

        sb.append("## Semantic Runtime Context\n");
        if (semContext != null && !semContext.isEmpty()) {
            sb.append("EXTRACTED_VALUES:\n");
            semContext.forEach((k, v) -> sb.append("- ").append(k).append(": ").append(v).append("\n"));
            sb.append("\n**IMPORTANT**: These are precise runtime values extracted from the error. You MUST use these exact numbers in your explanation.\n\n");
        } else {
            sb.append("Analysis of the failing line suggests the following logical roles:\n");
            sb.append("- The variable '").append(suspectedVariable).append("' is likely the primary cause because of its role in the expression.\n\n");
        }

        sb.append("## Source Code\n```").append(language != null ? language : "javascript").append("\n");
        sb.append(code != null ? code : "// no code provided").append("\n```\n\n");

        sb.append("## Your Task\n");
        sb.append("Respond in this EXACT format (use markdown). Keep it concise but insightful:\n\n");

        sb.append("### 🔍 What Happened\n");
        sb.append("(1-2 sentences explaining the error in simple, clear language. Focus on logical failure, e.g. 'division by zero' or 'accessing property of null'. Use an analogy if helpful.)\n\n");

        sb.append("### 🧬 Root Cause Chain\n");
        sb.append("(A step-by-step breakdown showing the causal chain that led to this error. Use numbered steps. ");
        sb.append("Each step should be one line. Max 4 steps.)\n\n");

        sb.append("### 🛠️ How to Fix\n");
        sb.append("(Provide the specific fix with a small corrected code snippet. ");
        sb.append("Show only the corrected lines, not the full code. Use a fenced code block.)\n\n");

        sb.append("### 💡 Pro Tip\n");
        sb.append("(One sentence of advice to prevent this type of error in the future.)\n\n");

        sb.append("RULES:\n");
        sb.append("- Be concise. No fluff.\n");
        sb.append("- Use the exact headers shown above (with emojis).\n");
        sb.append("- The code fix must be syntactically correct.\n");
        sb.append("- Speak directly to the developer (use \"you\").\n");

        return sb.toString();
    }

    /**
     * Sends a prompt to Gemini and returns the model's reply text.
     *
     * Exposed so other AI features (the auto-fix agent) share this one client
     * rather than standing up a second one. That matters because the key is
     * mutable at runtime — a second copy would keep serving the stale one after
     * the user activates a key from the UI.
     *
     * @return the reply, or null when the model returned no choices
     */
    public String complete(String prompt, int maxTokens, double temperature) throws Exception {
        return extractContent(callGemini(prompt, maxTokens, temperature));
    }

    /** Builds a generateContent request body: one user turn plus generation settings. */
    private String buildRequestBody(String prompt, int maxTokens, double temperature)
            throws com.fasterxml.jackson.core.JsonProcessingException {
        ObjectNode requestBody = objectMapper.createObjectNode();

        ObjectNode part = objectMapper.createObjectNode();
        part.put("text", prompt);
        ArrayNode parts = objectMapper.createArrayNode();
        parts.add(part);

        ObjectNode turn = objectMapper.createObjectNode();
        turn.set("parts", parts);

        ArrayNode contents = objectMapper.createArrayNode();
        contents.add(turn);
        requestBody.set("contents", contents);

        ObjectNode generationConfig = objectMapper.createObjectNode();
        generationConfig.put("maxOutputTokens", maxTokens);
        generationConfig.put("temperature", temperature);
        requestBody.set("generationConfig", generationConfig);

        return objectMapper.writeValueAsString(requestBody);
    }

    private HttpResponse<String> send(String key, String body) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(endpointUri())
                .header("Content-Type", "application/json")
                // Header rather than ?key= — a key in a URL leaks into logs.
                .header("x-goog-api-key", key)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .timeout(Duration.ofSeconds(90))
                .build();
        return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private String callGemini(String prompt, int maxTokens, double temperature) throws Exception {
        HttpResponse<String> response = send(apiKey, buildRequestBody(prompt, maxTokens, temperature));

        if (response.statusCode() != 200) {
            String reason = describeFailure(response.statusCode(), response.body());
            log.error("Gemini returned status {}: {}", response.statusCode(), response.body());
            // Carries the actionable text, not just a status code — the auto-fix
            // agent surfaces this message straight to the user.
            throw new RuntimeException(reason);
        }

        return response.body();
    }

    /**
     * Pulls the model's answer out of a generateContent response.
     *
     * Two silent-failure modes are handled explicitly rather than surfacing as
     * a bare empty string:
     *   - a safety filter blocked the prompt (no candidates at all)
     *   - thinking consumed the whole token budget (candidate present but no
     *     parts, finishReason MAX_TOKENS)
     * The second is the live risk here: 2.5 models think before answering, and
     * those tokens come out of the same allowance as the reply.
     */
    private String extractContent(String responseJson) throws Exception {
        JsonNode root = objectMapper.readTree(responseJson);

        JsonNode candidates = root.path("candidates");
        if (!candidates.isArray() || candidates.isEmpty()) {
            String blockReason = root.path("promptFeedback").path("blockReason").asText("");
            if (!blockReason.isEmpty()) {
                log.warn("Gemini blocked the prompt: {}", blockReason);
            } else {
                log.warn("No candidates in Gemini response: {}", trimForMessage(responseJson));
            }
            return null;
        }

        JsonNode candidate = candidates.get(0);
        JsonNode parts = candidate.path("content").path("parts");

        StringBuilder sb = new StringBuilder();
        if (parts.isArray()) {
            for (JsonNode p : parts) {
                JsonNode text = p.get("text");
                if (text != null && !text.isNull()) sb.append(text.asText());
            }
        }

        String answer = sb.toString();
        if (answer.isBlank()) {
            String finishReason = candidate.path("finishReason").asText("");
            if ("MAX_TOKENS".equals(finishReason)) {
                log.warn("Gemini spent the entire token budget on thinking and returned no answer "
                        + "(thoughtsTokenCount={}). Raise maxOutputTokens.",
                        root.path("usageMetadata").path("thoughtsTokenCount").asInt());
            } else {
                log.warn("Gemini returned an empty answer (finishReason={})", finishReason);
            }
            return null;
        }
        return answer;
    }

    private AiAnalysisResult parseResponse(String responseJson) throws Exception {
        String content = extractContent(responseJson);
        if (content == null) return null;

        AiAnalysisResult result = new AiAnalysisResult();
        result.setFullAnalysis(content);

        // Extract sections from the markdown response
        result.setWhatHappened(extractSection(content, "What Happened"));
        result.setRootCauseChain(extractSection(content, "Root Cause Chain"));
        result.setHowToFix(extractSection(content, "How to Fix"));
        result.setProTip(extractSection(content, "Pro Tip"));

        return result;
    }

    private String extractSection(String content, String sectionName) {
        // Look for the section header (with or without emoji)
        String[] patterns = {
            "### 🔍 " + sectionName, "### 🧬 " + sectionName,
            "### 🛠️ " + sectionName, "### 💡 " + sectionName,
            "### " + sectionName
        };

        int startIdx = -1;
        for (String pattern : patterns) {
            startIdx = content.indexOf(pattern);
            if (startIdx != -1) {
                startIdx += pattern.length();
                break;
            }
        }

        if (startIdx == -1) return null;

        // Find the next section (### header) or end of content
        int endIdx = content.indexOf("\n###", startIdx);
        if (endIdx == -1) endIdx = content.length();

        return content.substring(startIdx, endIdx).trim();
    }

    /**
     * Result container for AI analysis
     */
    public static class AiAnalysisResult {
        private String fullAnalysis;
        private String whatHappened;
        private String rootCauseChain;
        private String howToFix;
        private String proTip;

        public String getFullAnalysis() { return fullAnalysis; }
        public void setFullAnalysis(String fullAnalysis) { this.fullAnalysis = fullAnalysis; }
        public String getWhatHappened() { return whatHappened; }
        public void setWhatHappened(String whatHappened) { this.whatHappened = whatHappened; }
        public String getRootCauseChain() { return rootCauseChain; }
        public void setRootCauseChain(String rootCauseChain) { this.rootCauseChain = rootCauseChain; }
        public String getHowToFix() { return howToFix; }
        public void setHowToFix(String howToFix) { this.howToFix = howToFix; }
        public String getProTip() { return proTip; }
        public void setProTip(String proTip) { this.proTip = proTip; }
    }
}
