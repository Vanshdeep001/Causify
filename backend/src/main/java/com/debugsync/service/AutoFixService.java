/*
 * AutoFixService.java — Autonomous code repair agent
 *
 * The difference between this and AiAnalysisService is the loop. AiAnalysisService
 * asks the model what went wrong once and hands the prose to the user. This one
 * runs a closed feedback cycle:
 *
 *     propose a patch → apply it → RUN it → read the result
 *         ├── clean exit  → done, hand the user a verified fix
 *         └── still broken → tell the model what its own patch produced, retry
 *
 * That re-run is the whole point. A model asked to fix code will always sound
 * confident; only executing the result tells you whether it was right. Every
 * proposal that reaches the user has therefore either been proven to run, or is
 * explicitly labelled as unproven.
 *
 * Edits are line ranges over the ORIGINAL file, never a rewritten whole file.
 * Whole-file rewrites are what make AI edits untrustworthy — the model quietly
 * reformats, drops a comment, or "improves" untouched code, and the diff becomes
 * too big to review. A bounded line range can be checked at a glance.
 *
 * Nothing here writes to the user's file. It returns a proposal; the frontend
 * applies it only after the user accepts.
 */
package com.debugsync.service;

import com.debugsync.dto.AutoFixRequest;
import com.debugsync.dto.AutoFixResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

@Service
public class AutoFixService {

    private static final Logger log = LoggerFactory.getLogger(AutoFixService.class);

    /* Three is deliberate. If the model hasn't found it by the third read of its
     * own failures it is usually looping on the same idea, and every extra pass
     * costs the user another LLM round-trip plus another execution. */
    private static final int MAX_ATTEMPTS = 3;

    /* An error dump can be a full stack trace. The model needs the shape of the
     * failure, not every frame, and the UI shows it in a small box. */
    private static final int MAX_ERROR_CHARS = 1200;

    private final AiAnalysisService aiAnalysisService;
    private final ExecutionService executionService;
    private final ProjectErrorLocator projectErrorLocator;
    private final ProjectVerifier projectVerifier;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public AutoFixService(AiAnalysisService aiAnalysisService,
                          ExecutionService executionService,
                          ProjectErrorLocator projectErrorLocator,
                          ProjectVerifier projectVerifier) {
        this.aiAnalysisService = aiAnalysisService;
        this.executionService = executionService;
        this.projectErrorLocator = projectErrorLocator;
        this.projectVerifier = projectVerifier;
    }

    /* ─────────────────────────────────────────────────────────
     * The agent loop
     * ───────────────────────────────────────────────────────── */

    public AutoFixResponse generateFix(AutoFixRequest request) {
        AutoFixResponse response = new AutoFixResponse();
        response.setAttempts(new ArrayList<>());

        if (!aiAnalysisService.isConfigured()) {
            response.setStatus(AutoFixResponse.NO_AI_KEY);
            response.setMessage("Add a Gemini API key to use the auto-fix agent.");
            return response;
        }

        /* What are we even editing? In file mode the caller says. In project
         * mode nobody knows yet — the failure was a server log — so this is
         * where the agent works it out, and where it gives up honestly if it
         * cannot. */
        Target target = resolveTarget(request, response);
        if (target == null) return response;

        String code = target.code;
        String language = target.language;
        boolean canVerify = target.canVerify;
        response.setVerificationSupported(canVerify);
        response.setTargetPath(target.displayPath);

        int totalLines = code.split("\n", -1).length;
        List<AutoFixResponse.Attempt> attempts = response.getAttempts();

        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            response.setAttemptsUsed(attempt);

            Patch patch;
            try {
                patch = requestPatch(request, code, language, attempts);
            } catch (Exception e) {
                log.error("Auto-fix: model call failed on attempt {}: {}", attempt, e.getMessage());
                // A transport failure is not the model's fault and carries no
                // feedback worth retrying on, so stop rather than burn attempts.
                if (response.getStatus() == null) {
                    response.setStatus(AutoFixResponse.ERROR);
                    response.setMessage("Could not reach the AI service: " + e.getMessage());
                }
                return response;
            }

            if (patch == null || patch.edits.isEmpty()) {
                attempts.add(new AutoFixResponse.Attempt(attempt, null, false,
                        "The agent did not return a usable edit."));
                continue;
            }

            String invalid = validate(patch.edits, totalLines);
            if (invalid != null) {
                // Feed the rejection back rather than failing outright — an
                // out-of-range line number is something the model can correct.
                attempts.add(new AutoFixResponse.Attempt(attempt, patch.summary, false,
                        "Proposed an invalid edit: " + invalid));
                continue;
            }

            fillOldText(code, patch.edits);
            String candidate = applyEdits(code, patch.edits);

            if (candidate.equals(code)) {
                attempts.add(new AutoFixResponse.Attempt(attempt, patch.summary, false,
                        "The edit left the code unchanged."));
                continue;
            }

            // Carry this candidate on the response now, so an exhausted loop
            // still hands back its best (clearly-labelled) effort.
            response.setSummary(patch.summary);
            response.setExplanation(patch.explanation);
            response.setConfidence(patch.confidence);
            response.setEdits(patch.edits);
            response.setFixedCode(candidate);

            if (!canVerify) {
                attempts.add(new AutoFixResponse.Attempt(attempt, patch.summary, false, null));
                response.setStatus(AutoFixResponse.UNVERIFIED);
                response.setMessage(target.unverifiableReason);
                return response;
            }

            Verdict verdict = verify(target, candidate, request);

            if (verdict.verified) {
                attempts.add(new AutoFixResponse.Attempt(attempt, patch.summary, true, null));
                response.setStatus(AutoFixResponse.VERIFIED);
                response.setVerifiedOutput(verdict.output);
                response.setRemainingError(null);
                response.setMessage(attempt == 1
                        ? target.verifiedMessage
                        : "Verified on attempt " + attempt + " — " + target.verifiedTail);
                return response;
            }

            /* Inconclusive is not failure. The server timed out, or no checker
             * exists for this file type — the patch has not been disproved, and
             * retrying would only burn attempts on a test that cannot answer. */
            if (!verdict.conclusive) {
                attempts.add(new AutoFixResponse.Attempt(attempt, patch.summary, false, null));
                response.setStatus(AutoFixResponse.UNVERIFIED);
                response.setMessage(verdict.failure + " Review the change before applying it.");
                return response;
            }

            String failure = truncate(verdict.failure);
            attempts.add(new AutoFixResponse.Attempt(attempt, patch.summary, false, failure));
            response.setStatus(AutoFixResponse.UNVERIFIED);
            response.setRemainingError(failure);
            response.setMessage("The agent's fix still fails. Review it carefully before applying.");
        }

        if (response.getStatus() == null) {
            response.setStatus(AutoFixResponse.NO_FIX);
            response.setMessage("The agent could not produce a working fix after "
                    + MAX_ATTEMPTS + " attempts.");
        }
        return response;
    }

    /* ─────────────────────────────────────────────────────────
     * What are we editing, and how would we know if it worked
     * ───────────────────────────────────────────────────────── */

    /**
     * The file this run is about, plus how a candidate for it gets tested.
     *
     * Both modes end up here, which is the point: everything after resolution —
     * the prompt, the loop, the validation, the diff — is shared. Only how the
     * target is found and how it is proven differ.
     */
    private static class Target {
        String code;
        String language;
        /** Project-relative path shown to the user; null in plain file mode. */
        String displayPath;
        /** Absolute path on disk. Project mode only — file mode never touches disk. */
        Path absolutePath;
        boolean canVerify;
        String unverifiableReason;
        String verifiedMessage;
        String verifiedTail;
    }

    /** The answer from one verification attempt, whichever gate produced it. */
    private static class Verdict {
        final boolean verified;
        final boolean conclusive;
        final String failure;
        final String output;

        Verdict(boolean verified, boolean conclusive, String failure, String output) {
            this.verified = verified;
            this.conclusive = conclusive;
            this.failure = failure;
            this.output = output;
        }
    }

    /**
     * Work out which file to repair.
     *
     * @return the target, or null — in which case {@code response} already
     *         explains why, and the caller returns it untouched.
     */
    private Target resolveTarget(AutoFixRequest request, AutoFixResponse response) {
        return request.isProjectMode()
                ? resolveProjectTarget(request, response)
                : resolveFileTarget(request, response);
    }

    /** File mode: the caller already knows, and always did. */
    private Target resolveFileTarget(AutoFixRequest request, AutoFixResponse response) {
        String code = request.getCode();
        if (code == null || code.isBlank()) {
            response.setStatus(AutoFixResponse.NO_FIX);
            response.setMessage("There is no code to fix.");
            return null;
        }

        Target target = new Target();
        target.code = code;
        target.language = request.getLanguage();
        target.displayPath = request.getFilePath();
        target.canVerify = executionService.canDryRun(target.language, code);
        target.unverifiableReason =
                "This file can't be run on the backend, so the fix could not be verified. Review it before applying.";
        target.verifiedMessage = "Verified — the patched code runs clean.";
        target.verifiedTail = "the patched code runs clean.";
        return target;
    }

    /**
     * Project mode: read the log, find the file.
     *
     * Falls back to whatever the user has open when the log names nothing we can
     * place. That fallback is what makes "fix this" work while they are looking
     * at the broken file, which is the common case — but it is a fallback, not a
     * guess: if there is no open file either, the agent says it does not know.
     */
    private Target resolveProjectTarget(AutoFixRequest request, AutoFixResponse response) {
        String projectPath = request.getProjectPath();

        if (projectPath == null || projectPath.isBlank()) {
            response.setStatus(AutoFixResponse.NO_FIX);
            response.setMessage("Open the project as a folder so the agent can read and verify its files.");
            return null;
        }

        ProjectErrorLocator.Located located =
                projectErrorLocator.locate(request.getErrorLog(), projectPath);

        Target target = new Target();

        if (located != null) {
            target.code = located.getContent();
            target.displayPath = located.getRelativePath();
            target.absolutePath = located.getAbsolutePath();
            if (located.getLine() > 0 && request.getErrorLine() <= 0) {
                request.setErrorLine(located.getLine());
            }
        } else if (request.getCode() != null && !request.getCode().isBlank()
                && request.getFilePath() != null && !request.getFilePath().isBlank()) {
            target.code = request.getCode();
            target.displayPath = request.getFilePath();
            target.absolutePath = Paths.get(projectPath).resolve(request.getFilePath());
        } else {
            response.setStatus(AutoFixResponse.NO_FIX);
            response.setMessage(request.hasInstruction()
                    ? "Open the file you want changed, so the agent knows what to edit."
                    : "The log doesn't name a file inside this project, so the agent can't tell what to fix. Open the failing file and try again.");
            return null;
        }

        target.language = languageOf(target.displayPath, request.getLanguage());

        boolean canBoot = projectVerifier.canBoot(projectPath, request.getServerType());
        target.canVerify = true; // the syntax gate always runs; boot is a bonus
        target.unverifiableReason = canBoot
                ? "The fix could not be checked. Review it before applying."
                : "No dev server is running from this folder, so the fix could not be booted. Review it before applying.";
        target.verifiedMessage = canBoot
                ? "Verified — the server restarted clean with this fix."
                : "Verified — the patched file parses cleanly.";
        target.verifiedTail = canBoot
                ? "the server restarted clean."
                : "the patched file parses cleanly.";
        return target;
    }

    /** Put one candidate through whichever check this target supports. */
    private Verdict verify(Target target, String candidate, AutoFixRequest request) {
        if (!request.isProjectMode()) {
            ExecutionService.DryRunResult run = executionService.dryRun(candidate, target.language);
            return run.hasError()
                    ? new Verdict(false, true, run.getStderr(), null)
                    : new Verdict(true, true, null, run.getStdout());
        }

        ProjectVerifier.Result result = projectVerifier.verify(
                target.absolutePath, candidate, request.getProjectPath(), request.getServerType());

        return new Verdict(result.isVerified(), result.isConclusive(), result.getFailure(), null);
    }

    /** Extension → the language name the prompt and the checkers expect. */
    private String languageOf(String path, String fallback) {
        if (path == null) return fallback != null ? fallback : "javascript";
        String lower = path.toLowerCase();
        if (lower.endsWith(".py")) return "python";
        if (lower.endsWith(".java")) return "java";
        if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx")) return "cpp";
        if (lower.endsWith(".c")) return "c";
        if (lower.endsWith(".ts")) return "typescript";
        if (lower.endsWith(".tsx")) return "tsx";
        if (lower.endsWith(".jsx")) return "jsx";
        if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
        if (lower.endsWith(".html")) return "html";
        if (lower.endsWith(".css")) return "css";
        if (lower.endsWith(".json")) return "json";
        return fallback != null ? fallback : "javascript";
    }

    /* ─────────────────────────────────────────────────────────
     * Asking the model for a patch
     * ───────────────────────────────────────────────────────── */

    private Patch requestPatch(AutoFixRequest request, String code, String language,
                               List<AutoFixResponse.Attempt> previousAttempts) throws Exception {
        String prompt = buildPrompt(request, code, language, previousAttempts);
        // Low temperature: a repair has a right answer, and creative variation
        // here just means a wilder patch to review.
        //
        // 4000 tokens is deliberate headroom, not generosity. The model thinks
        // before answering and that spending comes out of this same budget
        // (~700 tokens even for a trivial fix), so a budget sized for the JSON
        // alone would return an empty reply on anything non-trivial — which
        // would look like the agent failing to find a fix rather than running
        // out of room to write one.
        String reply = aiAnalysisService.complete(prompt, 4000, 0.15);
        return parsePatch(reply);
    }

    private String buildPrompt(AutoFixRequest request, String code, String language,
                               List<AutoFixResponse.Attempt> previousAttempts) {
        StringBuilder sb = new StringBuilder();
        String lang = language != null ? language : "javascript";

        boolean instructed = request.hasInstruction();

        sb.append("You are an autonomous code agent inside an IDE called Causify.\n");
        sb.append(instructed
                ? "The user has asked for a change. Return the MINIMAL set of line edits that make it.\n\n"
                : "A program is failing. Return the MINIMAL set of line edits that make it run correctly.\n\n");

        if (instructed) {
            /* First, and in the user's own words. A paraphrase here is how an
             * agent ends up confidently doing the wrong job. */
            sb.append("## What the user asked for\n");
            sb.append(request.getUserInstruction().trim()).append("\n\n");
        }

        sb.append("## ").append(instructed ? "The file" : "Failing program");
        sb.append(" (").append(lang).append(")");
        if (request.isProjectMode() && request.getFilePath() != null) {
            sb.append(" — ").append(request.getFilePath());
        }
        sb.append("\n");
        sb.append("Line numbers are shown for reference and are NOT part of the code.\n\n");
        sb.append(numberLines(code)).append("\n\n");

        /* In project mode this file is one of many, and the model cannot see the
         * rest. Saying so stops it inventing imports for files it has not read. */
        if (request.isProjectMode()) {
            sb.append("## Context\n");
            sb.append("This file is part of a larger project. You are editing THIS FILE ONLY — ");
            sb.append("you cannot see or change any other file, so do not propose edits that ");
            sb.append("depend on changing one. If the real fix is in a different file, say so ");
            sb.append("in `explanation` and return an empty `edits` array.\n\n");
        }

        if (request.isProjectMode() && request.getErrorLog() != null && !request.getErrorLog().isBlank()) {
            sb.append("## What the dev server printed\n");
            sb.append("```\n").append(truncate(request.getErrorLog())).append("\n```\n\n");
        }

        boolean hasStructuredError = request.getErrorType() != null || request.getErrorMessage() != null;
        if (hasStructuredError || !instructed) {
            sb.append("## The error\n");
            sb.append("- Type: ").append(nz(request.getErrorType(), "Unknown")).append("\n");
            sb.append("- Message: ").append(nz(request.getErrorMessage(), "Unknown")).append("\n");
            if (request.getErrorLine() > 0) {
                sb.append("- Reported at line: ").append(request.getErrorLine()).append("\n");
            }
            if (request.getSuspectedVariable() != null && !request.getSuspectedVariable().isBlank()) {
                sb.append("- Suspected variable: `").append(request.getSuspectedVariable()).append("`\n");
            }
            sb.append("\n");
        }

        if (request.getSemanticContext() != null && !request.getSemanticContext().isEmpty()) {
            sb.append("## Runtime values captured at the failure\n");
            request.getSemanticContext().forEach((k, v) -> sb.append("- ").append(k).append(": ").append(v).append("\n"));
            sb.append("\n");
        }

        if (previousAttempts != null && !previousAttempts.isEmpty()) {
            sb.append("## Your previous attempts — ALL FAILED. Do not repeat them.\n");
            for (AutoFixResponse.Attempt a : previousAttempts) {
                sb.append("Attempt ").append(a.getNumber()).append(": ");
                sb.append(nz(a.getSummary(), "(no summary)"));
                sb.append("\n  Result: ").append(nz(a.getRejectedBecause(), "no change")).append("\n");
            }
            sb.append("\nDiagnose why those failed and take a DIFFERENT approach. ");
            sb.append("If the last error is different from the original one, you moved the problem — fix the new one too.\n\n");
        }

        sb.append("## Output format\n");
        sb.append("Return ONLY a JSON object. No prose, no markdown fences, nothing before or after it:\n");
        sb.append("{\n");
        sb.append("  \"summary\": \"<max 8 words, imperative, e.g. 'Guard against a zero divisor'>\",\n");
        sb.append("  \"explanation\": \"<1-2 sentences on why this fixes the root cause>\",\n");
        sb.append("  \"confidence\": <number between 0 and 1>,\n");
        sb.append("  \"edits\": [\n");
        sb.append("    { \"startLine\": <int>, \"endLine\": <int>, \"replacement\": \"<full new text for those lines>\" }\n");
        sb.append("  ]\n");
        sb.append("}\n\n");

        sb.append("RULES — a patch that breaks any of these is discarded:\n");
        sb.append("- Line numbers are 1-based and refer to the ORIGINAL program above.\n");
        sb.append("- `replacement` replaces lines startLine..endLine entirely. Use \\n between lines. Keep the original indentation.\n");
        sb.append("- An empty `replacement` deletes those lines.\n");
        sb.append("- To insert code, replace the line it goes next to and include that line in the replacement.\n");
        sb.append("- Edits must not overlap and must stay inside the file.\n");
        sb.append("- Change as FEW lines as possible. Never reformat, rename or 'improve' code that is not part of the change.\n");
        if (instructed) {
            sb.append("- Do EXACTLY what was asked, and nothing else. Unrequested extras are how a small\n");
            sb.append("  change becomes one the user has to unpick.\n");
            sb.append("- If the request is impossible in this file alone, return an empty `edits` array and\n");
            sb.append("  explain why. A wrong edit is worse than no edit.\n");
        } else {
            sb.append("- Fix the ROOT CAUSE. Never silence the error by deleting the failing line, wrapping everything in a\n");
            sb.append("  blanket try/catch, or removing output the program is supposed to produce.\n");
        }
        sb.append("- The program must still do what it was written to do.\n");
        sb.append("- Do not add comments that narrate the change.\n");

        return sb.toString();
    }

    /* ─────────────────────────────────────────────────────────
     * Parsing the model's JSON
     * ───────────────────────────────────────────────────────── */

    /**
     * Models wrap JSON in prose or fences no matter how firmly you ask them not
     * to, so take the outermost braces rather than trusting the reply verbatim.
     */
    private Patch parsePatch(String reply) {
        if (reply == null || reply.isBlank()) return null;

        int start = reply.indexOf('{');
        int end = reply.lastIndexOf('}');
        if (start == -1 || end <= start) {
            log.warn("Auto-fix: model reply contained no JSON object");
            return null;
        }

        try {
            JsonNode root = objectMapper.readTree(reply.substring(start, end + 1));
            Patch patch = new Patch();
            patch.summary = text(root, "summary");
            patch.explanation = text(root, "explanation");
            patch.confidence = root.has("confidence") ? clamp(root.get("confidence").asDouble()) : 0.0;

            JsonNode edits = root.get("edits");
            if (edits != null && edits.isArray()) {
                for (JsonNode e : edits) {
                    if (!e.has("startLine")) continue;
                    int startLine = e.get("startLine").asInt();
                    int endLine = e.has("endLine") ? e.get("endLine").asInt() : startLine;
                    String replacement = e.has("replacement") && !e.get("replacement").isNull()
                            ? e.get("replacement").asText()
                            : "";
                    patch.edits.add(new AutoFixResponse.FixEdit(startLine, endLine, null, replacement));
                }
            }
            return patch;
        } catch (Exception e) {
            log.warn("Auto-fix: could not parse model JSON: {}", e.getMessage());
            return null;
        }
    }

    /* ─────────────────────────────────────────────────────────
     * Applying edits
     * ───────────────────────────────────────────────────────── */

    /** @return null when the edits are safe to apply, otherwise why they are not */
    private String validate(List<AutoFixResponse.FixEdit> edits, int totalLines) {
        List<AutoFixResponse.FixEdit> sorted = new ArrayList<>(edits);
        sorted.sort(Comparator.comparingInt(AutoFixResponse.FixEdit::getStartLine));

        int previousEnd = 0;
        for (AutoFixResponse.FixEdit e : sorted) {
            if (e.getStartLine() < 1 || e.getEndLine() < e.getStartLine()) {
                return "line range " + e.getStartLine() + "-" + e.getEndLine() + " is not a valid range";
            }
            if (e.getEndLine() > totalLines) {
                return "line " + e.getEndLine() + " is past the end of the file (" + totalLines + " lines)";
            }
            if (e.getStartLine() <= previousEnd) {
                return "two edits overlap at line " + e.getStartLine();
            }
            previousEnd = e.getEndLine();
        }
        return null;
    }

    /** Records what each edit is replacing, so the UI can show a before/after diff. */
    private void fillOldText(String code, List<AutoFixResponse.FixEdit> edits) {
        String[] lines = code.split("\n", -1);
        for (AutoFixResponse.FixEdit e : edits) {
            String[] slice = Arrays.copyOfRange(lines, e.getStartLine() - 1, e.getEndLine());
            e.setOldText(String.join("\n", slice));
        }
    }

    private String applyEdits(String code, List<AutoFixResponse.FixEdit> edits) {
        List<String> lines = new ArrayList<>(Arrays.asList(code.split("\n", -1)));

        // Bottom-up, so each edit's line numbers still refer to the original file.
        List<AutoFixResponse.FixEdit> sorted = new ArrayList<>(edits);
        sorted.sort(Comparator.comparingInt(AutoFixResponse.FixEdit::getStartLine).reversed());

        for (AutoFixResponse.FixEdit e : sorted) {
            int from = e.getStartLine() - 1;
            int to = e.getEndLine();
            List<String> window = lines.subList(from, to);
            window.clear();

            String replacement = e.getNewText();
            // An empty replacement means "delete these lines" — inserting a blank
            // string here instead would leave a stray empty line behind.
            if (replacement != null && !replacement.isEmpty()) {
                window.addAll(Arrays.asList(replacement.split("\n", -1)));
            }
        }
        return String.join("\n", lines);
    }

    /* ─────────────────────────────────────────────────────────
     * Helpers
     * ───────────────────────────────────────────────────────── */

    private String numberLines(String code) {
        String[] lines = code.split("\n", -1);
        StringBuilder sb = new StringBuilder();
        int width = String.valueOf(lines.length).length();
        for (int i = 0; i < lines.length; i++) {
            sb.append(String.format("%" + width + "d| %s%n", i + 1, lines[i]));
        }
        return sb.toString();
    }

    private String truncate(String s) {
        if (s == null) return null;
        String trimmed = s.trim();
        return trimmed.length() <= MAX_ERROR_CHARS ? trimmed : trimmed.substring(0, MAX_ERROR_CHARS) + "…";
    }

    private String text(JsonNode node, String field) {
        return node.has(field) && !node.get(field).isNull() ? node.get(field).asText() : null;
    }

    private double clamp(double v) {
        return Math.max(0.0, Math.min(1.0, v));
    }

    private String nz(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    /** What the model proposed, before validation. */
    private static class Patch {
        String summary;
        String explanation;
        double confidence;
        final List<AutoFixResponse.FixEdit> edits = new ArrayList<>();
    }
}
