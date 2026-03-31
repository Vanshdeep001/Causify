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
import com.debugsync.util.ErrorParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class RootCauseService {

    private static final Logger log = LoggerFactory.getLogger(RootCauseService.class);
    private final SnapshotRepository snapshotRepository;

    public RootCauseService(SnapshotRepository snapshotRepository) {
        this.snapshotRepository = snapshotRepository;
    }

    // Main 4-step analysis method
    public ExecutionResponse.RootCauseData analyze(ErrorLog error, String code, String sessionId) {
        log.info("Starting root cause analysis for {} at line {}", error.getType(), error.getLineNumber());
        List<ExecutionResponse.StepData> steps = new ArrayList<>();

        // STEP 1: EXTRACT — get variables from the failing line
        String failingLine = getLineFromCode(code, error.getLineNumber());
        List<String> variables = ErrorParser.extractVariablesFromLine(failingLine);

        steps.add(new ExecutionResponse.StepData(1, "EXTRACT",
            "Failing line " + error.getLineNumber() + ": \"" + (failingLine != null ? failingLine.trim() : "?")
            + "\" → Variables: " + (variables.isEmpty() ? "none found" : String.join(", ", variables))));

        if (variables.isEmpty()) return buildPartialResult(error, steps);

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

        // Also check for null/undefined assignments
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
            if (recentChanges.containsKey(varName)) score += 0.4;
            int assignLine = variableAssignments.getOrDefault(varName, -1);
            if (assignLine > 0) {
                int distance = Math.abs(error.getLineNumber() - assignLine);
                score += Math.max(0, 0.3 - (distance * 0.02));
            }
            int occurrences = countOccurrences(code, varName);
            score += Math.min(0.3, occurrences * 0.05);
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
        String explanation = generateExplanation(error, suspectedVariable, recentChanges, code);

        ExecutionResponse.RootCauseData result = new ExecutionResponse.RootCauseData();
        result.setErrorType(error.getType());
        result.setErrorMessage(error.getMessage());
        result.setErrorLine(error.getLineNumber());
        result.setSteps(steps);
        result.setSuspectedVariable(suspectedVariable);
        result.setSuspectedChange(recentChanges.getOrDefault(suspectedVariable, "Initial value in code"));
        result.setExplanation(explanation);
        result.setConfidence(Math.min(0.95, bestScore + 0.15));
        return result;
    }

    private ExecutionResponse.RootCauseData buildPartialResult(ErrorLog error, List<ExecutionResponse.StepData> steps) {
        ExecutionResponse.RootCauseData result = new ExecutionResponse.RootCauseData();
        result.setErrorType(error.getType());
        result.setErrorMessage(error.getMessage());
        result.setErrorLine(error.getLineNumber());
        result.setSteps(steps);
        result.setExplanation("Could not identify specific variables. The error '" + error.getType() + "' occurred at line " + error.getLineNumber() + ".");
        result.setConfidence(0.3);
        return result;
    }

    private String generateExplanation(ErrorLog error, String suspectedVariable,
                                        Map<String, String> recentChanges, String code) {
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
