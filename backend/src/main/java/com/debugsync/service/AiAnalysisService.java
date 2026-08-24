/*
 * AiAnalysisService.java — AI-Powered Root Cause Analysis
 *
 * Produces, for a failing program:
 *   - A clear explanation of WHY the error happened
 *   - A breakdown of the root cause chain
 *   - An actionable suggested fix
 *
 * Also the single LLM entry point for the auto-fix agent (see AutoFixService),
 * which calls complete() directly.
 *
 * WHICH VENDOR ANSWERS IS NOT THIS CLASS'S BUSINESS. It owns the prompts and
 * the parsing of replies; the transport lives behind LlmProvider, so a user can
 * bring a key from OpenRouter, Groq, Gemini, Bedrock, OpenAI or any
 * OpenAI-compatible endpoint without a line of this file changing.
 *
 * The key, provider and model are all mutable at runtime: they arrive from
 * POST /api/ai/key and take effect on the next call, with no restart. That
 * matters because some keys expire within a day.
 *
 * NOTE ON TOKEN BUDGETS — reasoning models spend part of the output allowance
 * thinking before they write anything. Measured on Gemini 2.5 Flash: ~700
 * tokens of reasoning before a ~120 token answer. Budgets below are therefore
 * sized for thinking + answer; one sized for the answer alone comes back empty.
 */
package com.debugsync.service;

import com.debugsync.ai.LlmProvider;
import com.debugsync.ai.ProviderRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class AiAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(AiAnalysisService.class);

    private final ProviderRegistry registry;
    private final AiConfigStore configStore;

    /* All three are volatile and settable at runtime — see updateConfig(). The
     * @Value defaults only seed the initial state from env or application.yml. */
    @Value("${AI_API_KEY:${debugsync.ai.api-key:}}")
    private volatile String apiKey;

    @Value("${AI_PROVIDER:${debugsync.ai.provider:}}")
    private volatile String providerId;

    @Value("${AI_MODEL:${debugsync.ai.model:}}")
    private volatile String model;

    /** Only meaningful for the custom OpenAI-compatible provider. */
    @Value("${AI_BASE_URL:${debugsync.ai.base-url:}}")
    private volatile String baseUrl;

    public AiAnalysisService(ProviderRegistry registry, AiConfigStore configStore) {
        this.registry = registry;
        this.configStore = configStore;
    }

    /**
     * Pick up a key the user activated on a previous run.
     *
     * Only when nothing else has supplied one. AI_API_KEY (or a value in
     * application.yml) is an explicit instruction from whoever started the
     * process — including the desktop app, which passes the keychain copy that
     * way — and a file on disk must not quietly overrule it.
     *
     * @PostConstruct rather than the constructor: the @Value fields above are
     * injected after construction, so a constructor could only ever see them
     * null and would restore over a perfectly good env key every time.
     */
    @jakarta.annotation.PostConstruct
    void restoreSavedConfig() {
        if (isConfigured()) {
            log.info("AI provider supplied by the environment — the saved settings are left alone");
            return;
        }

        AiConfigStore.Saved saved = configStore.load();
        if (saved == null) return;

        this.apiKey = saved.key;
        this.providerId = (saved.provider == null || saved.provider.isBlank())
                ? providerIdFor(saved.key)
                : saved.provider;
        this.model = saved.model;
        this.baseUrl = saved.baseUrl;

        /* Deliberately not verified here. Startup is the worst possible moment
         * to spend a network round trip on a provider that is probably fine,
         * and a key that HAS expired reports itself clearly on the first real
         * request. Verification belongs where the user is watching: the moment
         * they paste it. */
        log.info("AI provider restored from saved settings: {} (model={})",
                this.providerId, (model == null || model.isBlank()) ? "default" : model);
    }

    /* ─────────────────────────────────────────────────────────
     * Configuration
     * ───────────────────────────────────────────────────────── */

    /** Whether a key is currently available (env, yml, or set at runtime). */
    public boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank();
    }

    /**
     * Swap the active credentials at runtime. A blank provider is detected from
     * the key's own shape, so the common case needs no choice from the user.
     */
    public void updateConfig(String key, String provider, String model, String baseUrl) {
        this.apiKey = key;
        this.providerId = (provider == null || provider.isBlank())
                ? providerIdFor(key)
                : provider;
        this.model = model;
        this.baseUrl = baseUrl;
        // Written now rather than on shutdown: the app is killed far more often
        // than it is closed cleanly, and a setting that only survives a polite
        // exit is one the user will be re-entering regularly.
        configStore.save(key, this.providerId, model, baseUrl);
        log.info("AI provider set to {} (model={})", this.providerId, (model == null || model.isBlank()) ? "default" : model);
    }

    /**
     * Forget the active credentials.
     *
     * Clears the model and base URL too, not just the key: leaving them behind
     * would silently apply one provider's model to the next key pasted in.
     */
    public void clearConfig() {
        this.apiKey = "";
        this.providerId = "";
        this.model = "";
        this.baseUrl = "";
        // Including the copy on disk. Clearing only the running service would
        // look like it worked right up until the next launch restored the key
        // the user had just asked to be rid of.
        configStore.clear();
        log.info("AI credentials cleared");
    }

    private String providerIdFor(String key) {
        LlmProvider detected = registry.detect(key);
        return detected != null ? detected.id() : "";
    }

    /** The provider currently in use, or null when none is configured. */
    public LlmProvider activeProvider() {
        if (!isConfigured()) return null;
        try {
            return registry.resolve(providerId, apiKey, baseUrl);
        } catch (Exception e) {
            return null;
        }
    }

    /** Model actually in effect, resolving the provider default when unset. */
    public String activeModel() {
        LlmProvider p = activeProvider();
        if (p == null) return model;
        return (model == null || model.isBlank()) ? p.defaultModel() : model;
    }

    /**
     * Verify a candidate configuration without storing it.
     *
     * @return null when it works, otherwise a short reason it does not
     */
    public String testConfig(String key, String provider, String model, String baseUrl) {
        try {
            LlmProvider p = registry.resolve(provider, key, baseUrl);
            return p.testKey(key, model);
        } catch (Exception e) {
            return e.getMessage();
        }
    }

    /**
     * A model this key can use, asked of the provider itself.
     *
     * Used when our built-in default has been retired, so a good key is not
     * rejected over a model id the user never chose.
     *
     * @return a usable model id, or null when the provider cannot say
     */
    public String suggestModel(String key, String provider, String baseUrl) {
        try {
            LlmProvider p = registry.resolve(provider, key, baseUrl);
            return p.suggestModel(key);
        } catch (Exception e) {
            return null;
        }
    }

    /* ─────────────────────────────────────────────────────────
     * The one call everything else goes through
     * ───────────────────────────────────────────────────────── */

    /**
     * Send a prompt to whichever provider is configured and return its reply.
     *
     * @return the reply, or null when the model returned nothing usable
     */
    public String complete(String prompt, int maxTokens, double temperature) throws Exception {
        return complete(prompt, maxTokens, temperature, false);
    }

    /**
     * The same call, for work where waiting costs more than deliberation does.
     *
     * See {@link LlmProvider#complete(String, String, String, int, double, boolean)}
     * — providers that cannot act on the hint ignore it, so passing true is
     * never worse than not passing it.
     */
    public String complete(String prompt, int maxTokens, double temperature, boolean preferSpeed)
            throws Exception {
        if (!isConfigured()) throw new IllegalStateException("No AI provider is configured.");
        LlmProvider provider = registry.resolve(providerId, apiKey, baseUrl);
        return provider.complete(apiKey, model, prompt, maxTokens, temperature, preferSpeed);
    }

    /**
     * Generates an AI-powered root cause analysis for a given error.
     * Returns a structured analysis with explanation and suggested fix.
     */
    public AiAnalysisResult analyze(String errorType, String errorMessage, int errorLine,
                                     String suspectedVariable, String code, String language,
                                     java.util.Map<String, String> semContext) {
        if (!isConfigured()) {
            log.warn("No AI provider configured — skipping AI analysis");
            return null;
        }

        try {
            String prompt = buildPrompt(errorType, errorMessage, errorLine, suspectedVariable, code, language, semContext);
            // 3500, not 800: a large part of it goes on reasoning before a word is written.
            return parseResponse(complete(prompt, 3500, 0.4));
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

    /** Splits the model's markdown reply into the sections the UI renders. */
    private AiAnalysisResult parseResponse(String content) {
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
