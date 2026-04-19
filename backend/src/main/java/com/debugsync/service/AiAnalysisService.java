/*
 * AiAnalysisService.java — AI-Powered Root Cause Analysis via OpenRouter
 * 
 * Calls OpenRouter's LLM API to generate:
 *   - A clear, creative explanation of WHY the error happened
 *   - A detailed breakdown of the root cause chain
 *   - Actionable suggested fixes with code examples
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
    private static final String OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

    // Primary: OPENROUTER_API_KEY env var. Fallback: debugsync.ai.openrouter-api-key in application.yml.
    @Value("${OPENROUTER_API_KEY:${debugsync.ai.openrouter-api-key:}}")
    private String apiKey;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    /**
     * Generates an AI-powered root cause analysis for a given error.
     * Returns a structured analysis with explanation and suggested fix.
     */
    public AiAnalysisResult analyze(String errorType, String errorMessage, int errorLine,
                                     String suspectedVariable, String code, String language,
                                     java.util.Map<String, String> semContext) {
        if (apiKey == null || apiKey.isBlank()) {
            log.warn("OpenRouter API key not configured — skipping AI analysis");
            return null;
        }

        try {
            String prompt = buildPrompt(errorType, errorMessage, errorLine, suspectedVariable, code, language, semContext);
            String response = callOpenRouter(prompt);
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

    private String callOpenRouter(String prompt) throws Exception {
        ObjectNode requestBody = objectMapper.createObjectNode();
        requestBody.put("model", "google/gemini-2.0-flash-001");
        requestBody.put("max_tokens", 800);
        requestBody.put("temperature", 0.4);

        ArrayNode messages = objectMapper.createArrayNode();
        ObjectNode message = objectMapper.createObjectNode();
        message.put("role", "user");
        message.put("content", prompt);
        messages.add(message);
        requestBody.set("messages", messages);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(OPENROUTER_API_URL))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .header("HTTP-Referer", "https://causify.dev")
                .header("X-Title", "Causify IDE")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(requestBody)))
                .timeout(Duration.ofSeconds(30))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() != 200) {
            log.error("OpenRouter API returned status {}: {}", response.statusCode(), response.body());
            throw new RuntimeException("OpenRouter API error: " + response.statusCode());
        }

        return response.body();
    }

    private AiAnalysisResult parseResponse(String responseJson) throws Exception {
        JsonNode root = objectMapper.readTree(responseJson);
        JsonNode choices = root.get("choices");
        if (choices == null || choices.isEmpty()) {
            log.warn("No choices in OpenRouter response");
            return null;
        }

        String content = choices.get(0).get("message").get("content").asText();

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
