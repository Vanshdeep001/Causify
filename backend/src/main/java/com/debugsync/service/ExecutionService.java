/*
 * ExecutionService.java — Runs user code and captures results
 * 
 * Flow: Write code → exec process → capture output → create snapshot
 *       → if error: parse → root cause analysis → causality graph
 */
package com.debugsync.service;

import com.debugsync.dto.ExecutionRequest;
import com.debugsync.dto.CommitSuggestionDto;
import com.debugsync.dto.ExecutionResponse;
import com.debugsync.model.*;
import com.debugsync.repository.*;
import com.debugsync.util.DiffUtil;
import com.debugsync.util.ErrorParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.file.*;
import java.util.Comparator;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class ExecutionService {

    private static final Logger log = LoggerFactory.getLogger(ExecutionService.class);

    private final SnapshotRepository snapshotRepository;
    private final ExecutionRepository executionRepository;
    private final ErrorRepository errorRepository;
    private final RootCauseService rootCauseService;
    private final CausalityGraphService causalityGraphService;
    private final TimelineService timelineService;
    private final GitAssistantService gitAssistantService;

    public ExecutionService(SnapshotRepository snapshotRepository,
                            ExecutionRepository executionRepository,
                            ErrorRepository errorRepository,
                            RootCauseService rootCauseService,
                            CausalityGraphService causalityGraphService,
                            TimelineService timelineService,
                            GitAssistantService gitAssistantService) {
        this.snapshotRepository = snapshotRepository;
        this.executionRepository = executionRepository;
        this.errorRepository = errorRepository;
        this.rootCauseService = rootCauseService;
        this.causalityGraphService = causalityGraphService;
        this.timelineService = timelineService;
        this.gitAssistantService = gitAssistantService;
    }

    public ExecutionResponse executeCode(ExecutionRequest request) {
        long startTime = System.currentTimeMillis();
        Path tempFile = null;

        try {
            // Step 1: Handle Language Dispatching
            String lang = (request.getLanguage() == null || "javascript".equals(request.getLanguage()))
                ? guessLanguage(request.getCode()) : request.getLanguage().toLowerCase();

            if ("java".equals(lang)) {
                return executeJava(request, startTime);
            }
            if ("c".equals(lang) || "cpp".equals(lang)) {
                return executeC(request, startTime, "cpp".equals(lang));
            }

            // --- Fix for HTML/CSS/React: Prevent crash when "running" static files ---
            boolean isReactCode = request.getCode().contains("import React") || request.getCode().contains("from 'react'") || request.getCode().contains("from \"react\"");
            boolean isStaticLang = "html".equals(lang) || "css".equals(lang) || "react".equals(lang) || "jsx".equals(lang) || "tsx".equals(lang);

            if (isStaticLang || isReactCode) {
                String msg = ("react".equals(lang) || "jsx".equals(lang) || "tsx".equals(lang) || isReactCode)
                    ? "[Causify] React file loaded.\n\n→ This is a UI frontend component, not a backend Node script!\n→ Please use the DEV SERVER tab (🚀) below to run frontend React apps."
                    : String.format("[Causify] Loaded %s file successfully.\nPreview is available in the web view.", lang.toUpperCase());

                return buildResponse(
                    msg,
                    null, 
                    request, 
                    System.currentTimeMillis() - startTime
                );
            }

            // Default behavior for other languages (Python, JS)
            String ext = ".js";
            if ("python".equals(lang)) ext = ".py";
            
            tempFile = Files.createTempFile("debugsync_", ext);
            Files.writeString(tempFile, request.getCode());

            String[] command = ("python".equals(lang)) 
                ? new String[]{"python", tempFile.toString()}
                : new String[]{"node", tempFile.toString()};

            return runProcess(command, request, startTime, tempFile);

        } catch (Exception e) {
            log.error("Code execution failed", e);
            ExecutionResponse response = new ExecutionResponse();
            response.setError("Internal error: " + e.getMessage());
            response.setExecutionTimeMs(System.currentTimeMillis() - startTime);
            return response;
        } finally {
            if (tempFile != null) { try { Files.deleteIfExists(tempFile); } catch (IOException ignored) {} }
        }
    }

    private ExecutionResponse executeJava(ExecutionRequest request, long startTime) throws Exception {
        Path tempDir = Files.createTempDirectory("debugsync_java_");
        try {
            String mainClass = findMainClass(request.getCode());
            if (mainClass == null) mainClass = "Main";
            
            Path javaFile = tempDir.resolve(mainClass + ".java");
            Files.writeString(javaFile, request.getCode());

            // Compile
            Process compileProcess = new ProcessBuilder("javac", javaFile.toString()).start();
            String compileError = readStream(compileProcess.getErrorStream());
            int compileCode = compileProcess.waitFor();

            if (compileCode != 0) {
                return buildResponse(null, compileError, request, System.currentTimeMillis() - startTime);
            }

            // Run
            String[] command = {"java", "-cp", tempDir.toString(), mainClass};
            return runProcess(command, request, startTime, null);

        } finally {
             // Cleanup directory
             Files.walk(tempDir)
                 .sorted(Comparator.reverseOrder())
                 .map(Path::toFile)
                 .forEach(File::delete);
        }
    }

    private ExecutionResponse executeC(ExecutionRequest request, long startTime, boolean isCpp) throws Exception {
        Path tempDir = Files.createTempDirectory("debugsync_c_");
        try {
            String ext = isCpp ? ".cpp" : ".c";
            Path srcFile = tempDir.resolve("main" + ext);
            Files.writeString(srcFile, request.getCode());

            Path outFile = tempDir.resolve("main.exe");
            String compiler = isCpp ? "g++" : "gcc";

            // Compile
            Process compileProcess = new ProcessBuilder(compiler, srcFile.toString(), "-o", outFile.toString()).start();
            String compileError = readStream(compileProcess.getErrorStream());
            int compileCode = compileProcess.waitFor();

            if (compileCode != 0) {
                return buildResponse(null, compileError, request, System.currentTimeMillis() - startTime);
            }

            // Run
            String[] command = { outFile.toString() };
            return runProcess(command, request, startTime, null);

        } finally {
            Files.walk(tempDir)
                .sorted(Comparator.reverseOrder())
                .map(Path::toFile)
                .forEach(File::delete);
        }
    }

    private String findMainClass(String code) {
        int mainIndex = code.indexOf("public static void main");
        if (mainIndex == -1) return null;
        
        String beforeMain = code.substring(0, mainIndex);
        Pattern classPattern = Pattern.compile("class\\s+(\\w+)");
        Matcher matcher = classPattern.matcher(beforeMain);
        String lastClass = null;
        while (matcher.find()) {
            lastClass = matcher.group(1);
        }
        return lastClass;
    }

    private ExecutionResponse runProcess(String[] command, ExecutionRequest request, long startTime, Path tempFile) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(false);
        Process process = pb.start();

        String stdout = readStream(process.getInputStream());
        String stderr = readStream(process.getErrorStream());

        boolean finished = process.waitFor(10, TimeUnit.SECONDS);
        if (!finished) { process.destroyForcibly(); stderr = "Execution timed out (10 second limit)"; }

        long executionTime = System.currentTimeMillis() - startTime;
        return buildResponse(stdout, stderr, request, executionTime);
    }

    private ExecutionResponse buildResponse(String stdout, String stderr, ExecutionRequest request, long executionTime) {
        // Create snapshot
        CodeSnapshot lastSnapshot = snapshotRepository.findTopBySessionIdOrderByTimestampDesc(request.getSessionId());
        String previousCode = lastSnapshot != null ? lastSnapshot.getCode() : "";
        String diff = DiffUtil.computeDiff(previousCode, request.getCode());
        boolean hasError = stderr != null && !stderr.isEmpty();

        CodeSnapshot snapshot = timelineService.createSnapshot(
            request.getSessionId(), request.getCode(), "system", diff, hasError);

        // Save execution log
        ExecutionLog execLog = new ExecutionLog();
        execLog.setSnapshotId(snapshot.getId());
        execLog.setOutput(stdout != null ? stdout : "");
        execLog.setError(stderr != null ? stderr : "");
        execLog.setExecutionTimeMs(executionTime);
        executionRepository.save(execLog);

        // Analysis if error
        ExecutionResponse.RootCauseData rootCauseData = null;
        ExecutionResponse.CausalityGraphData graphData = null;

        if (hasError) {
            ErrorLog parsedError = ErrorParser.parse(stderr, request.getCode());
            if (parsedError != null) {
                parsedError.setExecutionId(execLog.getId());
                errorRepository.save(parsedError);
                rootCauseData = rootCauseService.analyze(parsedError, request.getCode(), request.getSessionId());
                if (rootCauseData != null)
                    graphData = causalityGraphService.buildCausalityGraph(parsedError, rootCauseData, request.getCode());
            }
        } else {
            // Generate interaction graph for successful execution
            graphData = causalityGraphService.buildExecutionGraph(request.getCode());
        }

        // Build response
        ExecutionResponse response = new ExecutionResponse();
        response.setOutput(stdout != null ? stdout : "");
        response.setError(stderr == null || stderr.isEmpty() ? null : stderr);
        response.setExecutionTimeMs(executionTime);

        ExecutionResponse.SnapshotData snapData = new ExecutionResponse.SnapshotData();
        snapData.setId(snapshot.getId());
        snapData.setCode(snapshot.getCode());
        snapData.setUserId(snapshot.getUserId());
        snapData.setTimestamp(snapshot.getTimestamp().toString());
        snapData.setDiff(diff);
        snapData.setHasError(hasError);
        response.setSnapshot(snapData);

        response.setRootCause(rootCauseData);
        response.setCausalityGraph(graphData);
        
        // Git Assistant Analysis
        ExecutionLog prevExecutionLog = null;
        if (lastSnapshot != null) {
            prevExecutionLog = executionRepository.findBySnapshotId(lastSnapshot.getId());
        }
        
        String lang = (request.getLanguage() == null) ? "javascript" : request.getLanguage().toLowerCase();
        CommitSuggestionDto suggestion = gitAssistantService.analyze(lastSnapshot, prevExecutionLog, request.getCode(), hasError, diff, lang);
        
        if (suggestion != null) {
            response.setCommitSuggestion(suggestion);
            snapData.setSuggestion(suggestion);
            
            // Serialize to JSON and save to snapshot entity for persistence
            try {
                com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                String suggestionJson = mapper.writeValueAsString(suggestion);
                snapshot.setSuggestionJson(suggestionJson);
                snapshotRepository.save(snapshot);
            } catch (Exception e) {
                log.warn("Failed to serialize commit suggestion", e);
            }
        }
        
        return response;
    }

    private String guessLanguage(String code) {
        if (code == null) return "javascript";
        String trimmed = code.trim().toLowerCase();
        if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html") || trimmed.startsWith("<head") || trimmed.startsWith("<body")) return "html";
        if (code.contains("public static void main") || code.contains("System.out.println")) return "java";
        if (code.contains("def ") && code.contains(":")) return "python";
        if (code.contains("#include <stdio.h>") || code.contains("#include <stdlib.h>") || (code.contains("int main(") && code.contains("printf"))) return "c";
        if (code.contains("#include <iostream>") || code.contains("#include <string>") || code.contains("using namespace std") || code.contains("cout") || code.contains("std::")) return "cpp";
        if (code.contains("import react") || code.contains("from 'react'") || code.contains("from \"react\"") || (code.contains("export default") && code.contains("<div"))) return "react";
        return "javascript";
    }

    private String readStream(InputStream inputStream) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream))) {
            String line;
            while ((line = reader.readLine()) != null) sb.append(line).append("\n");
        }
        return sb.toString().trim();
    }
}
