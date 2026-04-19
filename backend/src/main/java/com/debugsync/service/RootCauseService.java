/*
 * RootCauseService.java — The Brain of DebugSync (4-Step Algorithm)
 * 
 * STEP 1: EXTRACT — Parse failing line, extract variable names
 * STEP 2: TRACE  — Find each variable's last assignment in history
 * STEP 3: MATCH  — Check if assignments changed in recent diffs
 * STEP 4: RANK   — Score candidates by recency, proximity, frequency
 */
package com.debugsync.service;

import com.debugsync.dto.ExecutionResponse;
import com.debugsync.model.CodeSnapshot;
import com.debugsync.model.ErrorLog;
import com.debugsync.repository.SnapshotRepository;
import com.debugsync.util.DiffUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class RootCauseService {

    private static final Logger log = LoggerFactory.getLogger(RootCauseService.class);
    private final SnapshotRepository snapshotRepository;
    private final AiAnalysisService aiAnalysisService;

    public RootCauseService(SnapshotRepository snapshotRepository, AiAnalysisService aiAnalysisService) {
        this.snapshotRepository = snapshotRepository;
        this.aiAnalysisService = aiAnalysisService;
    }

    // Main analysis method — dispatches to compiler or runtime analysis
    public ExecutionResponse.RootCauseData analyze(ErrorLog error, String code, String sessionId) {
        log.info("Starting root cause analysis for {} at line {}", error.getType(), error.getLineNumber());

        // ── FAST PATH: Compiler/Syntax Errors ──
        // These don't need variable tracing — they need code-level fixes
        if ("CompilationError".equals(error.getType()) || "SyntaxError".equals(error.getType())) {
            return analyzeCompilerError(error, code, sessionId);
        }

        // ── STANDARD PATH: Runtime Errors (JS, Java runtime, Python runtime) ──
        return analyzeRuntimeError(error, code, sessionId);
    }

    /**
     * Compiler/Syntax error analysis — no variable tracing needed.
     * Produces clean, structured output with AI-powered fix suggestions.
     */
    private ExecutionResponse.RootCauseData analyzeCompilerError(ErrorLog error, String code, String sessionId) {
        Map<String, String> semContext = parseSemanticContext(error.getSemanticContext());
        int errorCount = 1;
        try { 
            if (semContext.containsKey("errorCount")) 
                errorCount = Integer.parseInt(semContext.get("errorCount")); 
        } catch (NumberFormatException ignored) {}

        // Build step data for display
        List<ExecutionResponse.StepData> steps = new ArrayList<>();
        steps.add(new ExecutionResponse.StepData(1, "DETECT", 
            errorCount + " syntax error" + (errorCount > 1 ? "s" : "") + " detected at compilation"));

        String failingLine = getLineFromCode(code, error.getLineNumber());
        if (failingLine != null) {
            steps.add(new ExecutionResponse.StepData(2, "LOCATE", 
                "Line " + error.getLineNumber() + ": \"" + failingLine.trim() + "\""));
        }

        // Generate a human-readable explanation
        String whatHappened = generateCompilerExplanation(error, failingLine, errorCount);
        steps.add(new ExecutionResponse.StepData(3, "DIAGNOSE", whatHappened));

        // Build result
        ExecutionResponse.RootCauseData result = new ExecutionResponse.RootCauseData();
        result.setErrorType(error.getType());
        result.setErrorMessage(error.getMessage());
        result.setErrorLine(error.getLineNumber());
        result.setSteps(steps);
        result.setSuspectedVariable(null);
        result.setSuspectedChange(null);
        result.setExplanation(whatHappened);
        result.setConfidence(0.90);
        result.setSemanticContext(semContext);

        // Set the local whatHappened
        result.setWhatHappened(whatHappened);

        // Call AI for the actual fix suggestion
        String lang = guessLanguage(code);
        AiAnalysisService.AiAnalysisResult aiResult = aiAnalysisService.analyze(
            error.getType(), error.getMessage(), error.getLineNumber(),
            null, code, lang, semContext
        );

        if (aiResult != null) {
            if (aiResult.getWhatHappened() != null) result.setWhatHappened(aiResult.getWhatHappened());
            result.setRootCauseChain(aiResult.getRootCauseChain());
            result.setHowToFix(aiResult.getHowToFix());
            result.setProTip(aiResult.getProTip());
            result.setFullAiAnalysis(aiResult.getFullAnalysis());
        } else {
            // Fallback: generate a basic fix suggestion without AI
            result.setHowToFix(generateBasicFixSuggestion(error, failingLine));
            result.setProTip("Always check for missing semicolons, brackets, and parentheses before running your code.");
        }

        return result;
    }

    /** Generate a clear English explanation for compiler errors */
    private String generateCompilerExplanation(ErrorLog error, String failingLine, int errorCount) {
        String msg = error.getMessage().toLowerCase();
        StringBuilder sb = new StringBuilder();

        if (msg.contains("';' expected") || msg.contains("expected ';'")) {
            sb.append("You're missing a semicolon (;) at the end of a statement. ");
            sb.append("In Java, every statement must end with a semicolon.");
        } else if (msg.contains("')' expected") || msg.contains("'(' expected")) {
            sb.append("There's an unmatched parenthesis. Check that every opening '(' has a matching closing ')'.");
        } else if (msg.contains("'{' expected") || msg.contains("'}' expected")) {
            sb.append("There's a missing curly brace. Check that every '{' has a matching '}'.");
        } else if (msg.contains("cannot find symbol")) {
            sb.append("You're using a variable or method that hasn't been declared. Check for typos in variable names.");
        } else if (msg.contains("incompatible types")) {
            sb.append("You're trying to assign a value of one type to a variable of an incompatible type.");
        } else if (msg.contains("unreachable statement")) {
            sb.append("There's code after a return/break/continue statement that can never execute.");
        } else if (msg.contains("illegal start of expression")) {
            sb.append("There's a syntax problem — likely a misplaced keyword, extra bracket, or missing operator.");
        } else {
            sb.append("The compiler found a syntax issue: ").append(error.getMessage()).append(".");
        }

        if (errorCount > 1) {
            sb.append(" Note: fixing the first error on line ").append(error.getLineNumber())
              .append(" may resolve the other ").append(errorCount - 1).append(" error(s) too — ")
              .append("they're often cascading side-effects.");
        }

        return sb.toString();
    }

    /** Generate a basic code fix suggestion when AI is unavailable */
    private String generateBasicFixSuggestion(ErrorLog error, String failingLine) {
        if (failingLine == null) return "Review the code at line " + error.getLineNumber() + " for syntax issues.";
        
        String msg = error.getMessage().toLowerCase();
        String trimmed = failingLine.trim();

        if (msg.contains("';' expected")) {
            return "```\n// Change:\n" + trimmed + "\n// To:\n" + trimmed + (trimmed.endsWith(";") ? "" : ";") + "\n```";
        }
        
        return "```\n// Check line " + error.getLineNumber() + ":\n" + trimmed + "\n// Fix: " + error.getMessage() + "\n```";
    }

    /**
     * Runtime error analysis — the full 4-step algorithm
     * (EXTRACT → TRACE → MATCH → RANK)
     */
    private ExecutionResponse.RootCauseData analyzeRuntimeError(ErrorLog error, String code, String sessionId) {
        List<ExecutionResponse.StepData> steps = new ArrayList<>();
        Map<String, String> semContext = parseSemanticContext(error.getSemanticContext());

        // STEP 1: EXTRACT — get variables from the failing line
        String failingLine = getLineFromCode(code, error.getLineNumber());
        Map<String, String> varRoles = parseInvolvedVariables(error.getInvolvedVariables());
        List<String> variables = new ArrayList<>(varRoles.keySet());

        String extractDetail = "Failing line " + error.getLineNumber() + ": \"" + (failingLine != null ? failingLine.trim() : "?") + "\"";
        if (variables.isEmpty()) {
            steps.add(new ExecutionResponse.StepData(1, "EXTRACT", extractDetail + " → No variables found."));
            return buildPartialResult(error, steps, code, semContext);
        } else {
            String varsWithRoles = varRoles.entrySet().stream()
                .map(e -> e.getKey() + " [" + e.getValue() + "]")
                .collect(Collectors.joining(", "));
            steps.add(new ExecutionResponse.StepData(1, "EXTRACT", extractDetail + " → Variables: " + varsWithRoles));
        }

        // STEP 2: TRACE — find last assignments
        Map<String, Integer> variableAssignments = new LinkedHashMap<>();
        for (String varName : variables) {
            int assignmentLine = DiffUtil.findLastAssignment(code, varName);
            if (assignmentLine > 0) variableAssignments.put(varName, assignmentLine);
        }

        String traceDetail = variableAssignments.isEmpty()
            ? "No assignments found in current code"
            : variableAssignments.entrySet().stream()
                .map(e -> e.getKey() + " assigned at line " + e.getValue())
                .collect(Collectors.joining("; "));
        steps.add(new ExecutionResponse.StepData(2, "TRACE", traceDetail));

        // STEP 3: MATCH — check if variables changed recently
        List<CodeSnapshot> history = snapshotRepository.findBySessionIdOrderByTimestampAsc(sessionId);
        Map<String, String> recentChanges = new LinkedHashMap<>();

        if (history.size() >= 2) {
            CodeSnapshot previous = history.get(history.size() - 2);
            CodeSnapshot current = history.get(history.size() - 1);
            List<String> modifiedVars = DiffUtil.findModifiedVariables(previous.getCode(), current.getCode());
            for (String varName : variables) {
                if (modifiedVars.contains(varName))
                    recentChanges.put(varName, "Modified in recent change (snapshot #" + history.size() + ")");
            }
        }

        for (String varName : variables) {
            if (!recentChanges.containsKey(varName)) {
                int assignLine = variableAssignments.getOrDefault(varName, -1);
                if (assignLine > 0) {
                    String assignmentLine = getLineFromCode(code, assignLine);
                    if (assignmentLine != null && (assignmentLine.contains("null") || assignmentLine.contains("undefined")))
                        recentChanges.put(varName, "Set to null/undefined at line " + assignLine);
                }
            }
        }

        String matchDetail = recentChanges.isEmpty()
            ? "No suspicious recent changes found for these variables"
            : recentChanges.entrySet().stream().map(e -> e.getKey() + ": " + e.getValue()).collect(Collectors.joining("; "));
        steps.add(new ExecutionResponse.StepData(3, "MATCH", matchDetail));

        // STEP 4: RANK — score candidates
        String suspectedVariable = null;
        double bestScore = 0;
        Map<String, Double> scores = new LinkedHashMap<>();

        for (String varName : variables) {
            double score = 0;
            String role = varRoles.getOrDefault(varName, "neutral");
            
            if ("divisor".equals(role)) score += 0.9;
            else if ("base_object".equals(role)) score += 0.8;
            else if ("index".equals(role)) score += 0.7;
            
            if ("index".equals(role) && semContext.containsKey("index")) score += 0.5;
            if (semContext.containsKey("base") && varName.equals(semContext.get("base"))) score += 0.4;
            
            if (recentChanges.containsKey(varName)) score += 0.4;
            
            int assignLine = variableAssignments.getOrDefault(varName, -1);
            if (assignLine > 0) {
                int distance = Math.abs(error.getLineNumber() - assignLine);
                score += Math.max(0, 0.3 - (distance * 0.02));
            }
            
            int occurrences = countOccurrences(code, varName);
            score += Math.min(0.2, occurrences * 0.04);
            
            scores.put(varName, Math.round(score * 100.0) / 100.0);
            if (score > bestScore) { bestScore = score; suspectedVariable = varName; }
        }

        String rankDetail = scores.entrySet().stream()
            .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
            .map(e -> e.getKey() + " — score: " + e.getValue())
            .collect(Collectors.joining("; "));
        steps.add(new ExecutionResponse.StepData(4, "RANK",
            rankDetail + (suspectedVariable != null ? " → Winner: " + suspectedVariable : "")));

        // Build result
        String explanation = generateExplanation(error, suspectedVariable, recentChanges, code, semContext);

        ExecutionResponse.RootCauseData result = new ExecutionResponse.RootCauseData();
        result.setErrorType(error.getType());
        result.setErrorMessage(error.getMessage());
        result.setErrorLine(error.getLineNumber());
        result.setSteps(steps);
        result.setSuspectedVariable(suspectedVariable);
        result.setSuspectedChange(recentChanges.getOrDefault(suspectedVariable, "Initial value in code"));
        result.setExplanation(explanation);
        result.setConfidence(Math.min(0.95, bestScore + 0.15));
        result.setSemanticContext(semContext);

        // STEP 5: AI Analysis
        String lang = guessLanguage(code);
        AiAnalysisService.AiAnalysisResult aiResult = aiAnalysisService.analyze(
            error.getType(), error.getMessage(), error.getLineNumber(), 
            suspectedVariable, code, lang, semContext
        );

        if (aiResult != null) {
            result.setWhatHappened(aiResult.getWhatHappened());
            result.setRootCauseChain(aiResult.getRootCauseChain());
            result.setHowToFix(aiResult.getHowToFix());
            result.setProTip(aiResult.getProTip());
            result.setFullAiAnalysis(aiResult.getFullAnalysis());
        }

        return result;
    }

    private String guessLanguage(String code) {
        if (code == null) return "javascript";
        String trimmed = code.trim().toLowerCase();
        if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html")) return "html";
        if (code.contains("public static void main")) return "java";
        if (code.contains("def ") && code.contains(":")) return "python";
        return "javascript";
    }

    private Map<String, String> parseInvolvedVariables(String involved) {
        Map<String, String> map = new LinkedHashMap<>();
        if (involved == null || involved.isEmpty()) return map;
        String[] parts = involved.split(",");
        for (String p : parts) {
            String[] kv = p.split(":");
            if (kv.length == 2) map.put(kv[0], kv[1]);
            else map.put(p, "neutral");
        }
        return map;
    }

    private Map<String, String> parseSemanticContext(String context) {
        Map<String, String> map = new LinkedHashMap<>();
        if (context == null || context.isEmpty()) return map;
        String[] parts = context.split(";");
        for (String p : parts) {
            String[] kv = p.split("=");
            if (kv.length == 2) map.put(kv[0], kv[1]);
        }
        return map;
    }

    private ExecutionResponse.RootCauseData buildPartialResult(ErrorLog error, List<ExecutionResponse.StepData> steps,
                                                                  String code, Map<String, String> semContext) {
        ExecutionResponse.RootCauseData result = new ExecutionResponse.RootCauseData();
        result.setErrorType(error.getType());
        result.setErrorMessage(error.getMessage());
        result.setErrorLine(error.getLineNumber());
        result.setSteps(steps);
        result.setExplanation("The error '" + error.getType() + "' occurred at line " + error.getLineNumber() + ".");
        result.setConfidence(0.3);
        result.setSemanticContext(semContext);

        // Still try AI analysis — it can often explain errors even without variable info
        String lang = guessLanguage(code);
        AiAnalysisService.AiAnalysisResult aiResult = aiAnalysisService.analyze(
            error.getType(), error.getMessage(), error.getLineNumber(),
            null, code, lang, semContext
        );

        if (aiResult != null) {
            result.setWhatHappened(aiResult.getWhatHappened());
            result.setRootCauseChain(aiResult.getRootCauseChain());
            result.setHowToFix(aiResult.getHowToFix());
            result.setProTip(aiResult.getProTip());
            result.setFullAiAnalysis(aiResult.getFullAnalysis());
            result.setConfidence(0.70);
        }

        return result;
    }

    private String generateExplanation(ErrorLog error, String suspectedVariable,
                                        Map<String, String> recentChanges, String code,
                                        Map<String, String> semContext) {
        // Special case: Direct Precision for Index/Bounds errors
        if (semContext.containsKey("index") && semContext.containsKey("length")) {
            String index = semContext.get("index");
            int len = Integer.parseInt(semContext.get("length"));
            return String.format("The error occurred because index %s exceeds the valid range (0 to %d). " +
                                 "This resulted in an ArrayIndexOutOfBoundsException when accessing the array.", 
                                 index, len - 1);
        }

        StringBuilder sb = new StringBuilder();
        sb.append("The ").append(error.getType()).append(" at line ").append(error.getLineNumber()).append(" occurred because ");
        if (suspectedVariable != null) {
            sb.append("the variable '").append(suspectedVariable).append("' ");
            String change = recentChanges.get(suspectedVariable);
            if (change != null && change.contains("null")) {
                sb.append("is null when the code expects it to have a value. ");
                sb.append("Check where '").append(suspectedVariable).append("' is assigned and ensure it's properly initialized.");
            } else if (change != null && change.contains("Modified")) {
                sb.append("was recently modified. ").append(change).append(". This recent change may have introduced the bug.");
            } else {
                sb.append("may not have the expected value at runtime. Verify its initialization.");
            }
        } else {
            sb.append("'").append(error.getMessage()).append("'. Review the code at line ").append(error.getLineNumber()).append(".");
        }
        return sb.toString();
    }

    private String getLineFromCode(String code, int lineNumber) {
        if (code == null || lineNumber <= 0) return null;
        String[] lines = code.split("\n");
        return lineNumber <= lines.length ? lines[lineNumber - 1] : null;
    }

    private int countOccurrences(String code, String varName) {
        if (code == null || varName == null) return 0;
        int count = 0, index = 0;
        while ((index = code.indexOf(varName, index)) != -1) { count++; index += varName.length(); }
        return count;
    }
}
